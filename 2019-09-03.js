/* global fetch */

const { GUI } = require('dat.gui')
const createDlite = require('./dlite/dlite-0.0.4')
const createLoopToggle = require('./helpers/create-loop')
const { createSpring } = require('spring-animator')

const MAPBOX_TOKEN = require('./mapbox-token')

const DATA_PATH = 'data/flights-timeseries.json'
const AIRPORT_DICT_PATH = 'data/airport-dict.json'

const viewState = {
  center: [-95.496, 39.987],
  zoom: 4,
  bearing: 0,
  pitch: 0
}
const dlite = createDlite(MAPBOX_TOKEN, viewState)

const settings = {
  opacity: 0.015,
  size: 10,
  arcResolution: 40,
  selectedMonth: 0,
  windowSize: 24,
  arcHeight: 1,
  framesPerMonth: 5,
  framesPerViewState: 2200,
  stiffness: 0.0025,
  damping: 0.22,
  animate: true,
  isRoaming: false,
  primitive: 'line loop'
}

window.dlite = dlite

Promise.all([
  fetch(DATA_PATH).then(res => res.json()),
  fetch(AIRPORT_DICT_PATH).then(res => res.json())
]).then(([data, airports]) => {
  const toggleLoop = createLoopToggle(render)
  dlite.onload.then(toggleLoop)

  const gui = new GUI()
  gui.add(settings, 'opacity', 0.01, 0.3)
  gui.add(settings, 'size', 1, 100000)
  gui.add(settings, 'selectedMonth', 0, 240).step(1).listen()
  gui.add(settings, 'windowSize', 0, 120)
  gui.add(settings, 'arcHeight', 0, 2)
  gui.add(settings, 'framesPerMonth', 0.1, 50)
  gui.add(settings, 'framesPerViewState', 1, 3000).step(1)
  gui.add(settings, 'stiffness', 0.0001, 0.1).step(0.0001)
  gui.add(settings, 'damping', 0, 1)
  gui.add(settings, 'animate')
  gui.add(settings, 'isRoaming')
  gui.add(settings, 'primitive', ['points', 'lines', 'line loop', 'triangles', 'triangle strip'])
  gui.add({ setNewCameraPosition }, 'setNewCameraPosition')

  const cameraAnimator = createCameraAnimator(dlite.mapbox, settings.stiffness, settings.damping)

  const heightSpring = createSpring(0.01, 0.2, 0)

  let frames = 0
  function setNewCameraPosition () {
    cameraAnimator.setValues({
      center: viewState.center.slice().map(v => v + (Math.random() - 0.5) * 3),
      zoom: viewState.zoom + (Math.random() - 0.5) * 3,
      bearing: Math.random() * 120 - 60,
      pitch: Math.random() * 60
    })
    frames = 0
  }

  const arcInterpolations = new Array(settings.arcResolution).fill().map((_, i) => [
    i / (settings.arcResolution - 1),
    Math.sin(i / (settings.arcResolution - 1) * Math.PI)
  ]).flat()

  const typedData = getData(data.routeData, airports)
  const instanceCount = typedData.origins.length / 2

  const destinationColors = dlite.createVertexBuffer(dlite.gl.FLOAT, 4, new Float32Array(instanceCount * 4), dlite.gl.DYNAMIC_DRAW)
  const colorGpuSpring = createGPUSpring(dlite, 4, new Float32Array(instanceCount * 4))

  const updateColorDestState = dlite({
    vertexArray: dlite.createVertexArray()
      .vertexAttributeBuffer(0, dlite.createVertexBuffer(dlite.gl.FLOAT, 2, typedData.timestamps))
      .vertexAttributeBuffer(1, dlite.createVertexBuffer(dlite.gl.FLOAT, 3, typedData.counts)),
    vs: `#version 300 es
    precision highp float;
    layout(location=0) in vec2 timestamp;
    layout(location=1) in vec3 counts;

    uniform float opacity;
    uniform vec2 timeWindow;

    out vec4 vColor;

    #define PURPLE vec3(61, 72, 139) / 255.0
    #define BLUE vec3(31, 130, 143) / 255.0
    #define YELLOW vec3(226, 230, 0) / 255.0

    void main() {
      float y = timestamp.x;
      float m = timestamp.y;
      float month = (y - 1990.0) * 12.0 + m;

      float windowStart = timeWindow.x;
      float windowEnd = timeWindow.y;
      float windowMiddle = mix(windowStart, windowEnd, 0.5);

      float t = min(
        smoothstep(windowStart, windowMiddle, month),
        1.0 - smoothstep(windowMiddle, windowEnd, month)
      );

      if (t < 0.001) {
        vColor = vec4(0);
      } else {
        // HACK: adding this so the compiler doesn't strip out the project_uCenter uniform
        // because PicoGL ends up throwing errors when we try to pass it in but it's been stripped out of the source
        vec4 wastedVar = project_position_to_clipspace(vec3(0));

        float availableCapacity = (counts.y - counts.x) / counts.y;
        vec3 c;
        if (availableCapacity < 0.5) {
          c = mix(PURPLE, BLUE, smoothstep(0.3, 0.5, availableCapacity));
        } else {
          c = mix(BLUE, YELLOW, smoothstep(0.5, 0.7, availableCapacity));
        }

        vColor = vec4(c, opacity * t);
      }
    }`,
    transform: {
      vColor: destinationColors
    },
    count: instanceCount
  })

  const renderVertexArray = dlite.createVertexArray()
    .vertexAttributeBuffer(0, dlite.createVertexBuffer(dlite.gl.FLOAT, 2, new Float32Array(arcInterpolations)))
    .instanceAttributeBuffer(1, dlite.createVertexBuffer(dlite.gl.FLOAT, 2, typedData.origins))
    .instanceAttributeBuffer(2, dlite.createVertexBuffer(dlite.gl.FLOAT, 2, typedData.destinations))
    .instanceAttributeBuffer(3, colorGpuSpring.getCurrentValue())

  const renderPoints = dlite({
    vertexArray: renderVertexArray,
    vs: `#version 300 es
    precision highp float;
    layout(location=0) in vec2 arcPosition;
    layout(location=1) in vec2 iOrigin;
    layout(location=2) in vec2 iDestination;
    layout(location=3) in vec4 iColor;

    uniform float size;
    uniform float arcHeight;

    out vec4 vColor;
    out float vHeight;

    void main() {
      if (iColor.a < 0.001) {
        gl_Position = vec4(0);
        gl_PointSize = 0.0;
        vColor = vec4(0);
        vHeight = 0.0;
        return;
      }

      vec2 delta = (iDestination - iOrigin) * arcPosition.x;

      vec4 worldOrigin = project_position(vec4(iOrigin, 0, 0));
      vec4 worldDestination = project_position(vec4(iDestination, 0, 0));
      float worldDist = distance(worldOrigin, worldDestination);
      float meters = 1.0 / project_size(1.0 / worldDist);
      vHeight = arcHeight * meters / 2.0;

      vHeight = arcPosition.y * arcHeight * meters / 2.0;
      vec3 position = vec3(iOrigin + delta, vHeight);

      gl_Position = project_position_to_clipspace(position);
      gl_PointSize = project_size(size);

      vColor = iColor;
    }`,

    fs: `#version 300 es
    precision highp float;
    in vec4 vColor;
    in float vHeight;
    out vec4 fragColor;
    void main() {
      if (vHeight < 0.001 || vColor.a < 0.001) {
        discard;
      }
      fragColor = vColor;
    }`,

    blend: {
      csrc: dlite.gl.SRC_ALPHA,
      asrc: dlite.gl.SRC_ALPHA,
      cdest: dlite.gl.ONE,
      adest: dlite.gl.ONE
    }
  })

  const timestampDiv = document.body.appendChild(document.createElement('div'))
  timestampDiv.style.position = 'fixed'
  timestampDiv.style.bottom = '100px'
  timestampDiv.style.right = '100px'
  timestampDiv.style.fontFamily = 'monospace'
  timestampDiv.style.fontSize = '40px'
  timestampDiv.style.color = 'white'

  function render (t) {
    dlite.clear(0, 0, 0, 0)

    if (settings.animate) {
      if (frames > settings.framesPerMonth) {
        frames = 0
        const incr = settings.framesPerMonth < 1 ? 1 / settings.framesPerMonth : 1
        settings.selectedMonth += incr
        if (settings.selectedMonth > 240 - settings.windowSize / 2) {
          settings.selectedMonth = settings.windowSize / 2
        }
      }
      frames += 1
    }

    if (settings.isRoaming) {
      if (frames % settings.framesPerViewState === 0) setNewCameraPosition()
      frames += 1
      cameraAnimator.tick()
    }

    heightSpring.setDestination(settings.arcHeight)
    heightSpring.tick(settings.stiffness, settings.damping)
    const arcHeight = heightSpring.getCurrentValue()

    const y = ((settings.selectedMonth / 12) | 0) + 1990
    timestampDiv.innerText = y

    const primitives = {
      points: dlite.gl.POINTS,
      lines: dlite.gl.LINES,
      'line loop': dlite.gl.LINE_LOOP,
      triangles: dlite.gl.TRIANGLES,
      'triangle strip': dlite.gl.TRIANGLE_STRIP
    }

    renderVertexArray.instanceAttributeBuffer(3, colorGpuSpring.getCurrentValue())

    renderPoints({
      count: settings.arcResolution,
      instanceCount: instanceCount,
      primitive: primitives[settings.primitive],
      uniforms: {
        size: settings.size,
        arcHeight: arcHeight
      }
    })

    updateColorDestState({
      uniforms: {
        opacity: settings.opacity,
        timeWindow: new Float32Array([settings.selectedMonth - settings.windowSize / 2, settings.selectedMonth + settings.windowSize / 2])
      }
    })

    colorGpuSpring.setDestination(destinationColors)
    colorGpuSpring.tick(settings.stiffness, settings.damping)
  }
})

function getData (routes, airports) {
  const routeNames = Object.keys(routes)
    .filter(name => airports[routes[name].origin] && airports[routes[name].destination])

  const origins = []
  const destinations = []
  const timestamps = []
  const counts = []

  for (const name of routeNames) {
    const route = routes[name]
    const origin = airports[route.origin]
    const dest = airports[route.destination]

    for (const month of Object.keys(route.series)) {
      const y = parseInt(month.slice(0, 4), 10)
      const m = parseInt(month.slice(4), 10)
      const p = parseInt(route.series[month].passengers, 10)
      const s = parseInt(route.series[month].seats, 10)
      const f = parseInt(route.series[month].flights, 10)
      origins.push(origin.longitude, origin.latitude)
      destinations.push(dest.longitude, dest.latitude)
      timestamps.push(y, m)
      counts.push(p, s, f)
    }
  }

  return {
    origins: new Float32Array(origins), // vec2 [lng, lat]
    destinations: new Float32Array(destinations), // vec2 [lng, lat]
    timestamps: new Float32Array(timestamps), // vec2 [year, month]
    counts: new Float32Array(counts) // vec3 [passengers, seats, flights]
  }
}

// ----------------------------------------------------

// TODO:
// (1) Shouldn't depend on dlite
function createGPUSpring (dlite, size, data, stiffness, damping) {
  const SIZE_TO_TYPE = {
    1: 'float',
    2: 'vec2',
    3: 'vec3',
    4: 'vec4'
  }
  const type = SIZE_TO_TYPE[size]
  const count = data.length / size
  const bufferCycle = createCycler(
    dlite.createVertexBuffer(dlite.gl.FLOAT, size, data, dlite.gl.DYNAMIC_DRAW),
    dlite.createVertexBuffer(dlite.gl.FLOAT, size, data, dlite.gl.DYNAMIC_DRAW),
    dlite.createVertexBuffer(dlite.gl.FLOAT, size, data, dlite.gl.DYNAMIC_DRAW)
  )
  let destinationBuffer = bufferCycle.getCurrent()

  const springStateVertexArray = dlite.createVertexArray()

  const updateSpringState = dlite({
    vs: `#version 300 es
    precision highp float;
    layout(location=0) in ${type} prevValue;
    layout(location=1) in ${type} curValue;
    layout(location=2) in ${type} destValue;

    uniform float stiffness;
    uniform float damping;

    out ${type} vNextValue;

    ${type} getNextValue(${type} cur, ${type} prev, ${type} dest) {
      ${type} velocity = cur - prev;
      ${type} delta = dest - cur;
      ${type} spring = delta * stiffness;
      ${type} damper = velocity * -1.0 * damping;
      return spring + damper + velocity + cur;
    }

    void main() {
      // HACK: adding this so the compiler doesn't strip out the project_uCenter uniform
      // because PicoGL ends up throwing errors when we try to pass it in but it's been stripped out of the source
      vec4 wastedVar = project_position_to_clipspace(vec3(0));

      vNextValue = getNextValue(curValue, prevValue, destValue);
    }`,
    transform: {
      vNextValue: bufferCycle.getNext()
    },
    vertexArray: springStateVertexArray,
    count: count
  })

  return { tick, setDestination, getCurrentValue }
  function setDestination (buffer) {
    destinationBuffer = buffer
  }
  function getCurrentValue () {
    return bufferCycle.getCurrent()
  }
  function tick (s, d) {
    springStateVertexArray
      .vertexAttributeBuffer(0, bufferCycle.getPrevious())
      .vertexAttributeBuffer(1, bufferCycle.getCurrent())
      .vertexAttributeBuffer(2, destinationBuffer)
    updateSpringState({
      uniforms: {
        stiffness: Number.isFinite(s) ? s : stiffness,
        damping: Number.isFinite(d) ? d : damping
      },
      transform: {
        vNextValue: bufferCycle.getNext()
      }
    })
    bufferCycle.rotate()
  }
}

function createCycler (first, second, third) {
  let curBufferIdx = 0
  const buffers = [first, second, third]
  return {
    getPrevious: () => buffers[curBufferIdx],
    getCurrent: () => buffers[(curBufferIdx + 1) % 3],
    getNext: () => buffers[(curBufferIdx + 2) % 3],
    rotate: () => { curBufferIdx = (curBufferIdx + 1) % 3 }
  }
}

function createCameraAnimator (mapbox, stiffness, damping) {
  const { center, zoom, bearing, pitch } = getValues()

  const centerSpring = createSpring(stiffness, damping, center)
  const pitchSpring = createSpring(stiffness, damping, pitch)
  const bearingSpring = createSpring(stiffness, damping, bearing)
  const zoomSpring = createSpring(stiffness, damping, zoom)

  function getValues () {
    const center = mapbox.getCenter().toArray()
    const zoom = mapbox.getZoom()
    const bearing = mapbox.getBearing()
    const pitch = mapbox.getPitch()
    return { center, zoom, bearing, pitch }
  }

  function setValues ({ center, zoom, bearing, pitch }) {
    centerSpring.setDestination(center)
    pitchSpring.setDestination(pitch)
    bearingSpring.setDestination(bearing)
    zoomSpring.setDestination(zoom)
  }

  function tick (stiffness, damping) {
    centerSpring.tick(stiffness, damping)
    pitchSpring.tick(stiffness, damping)
    bearingSpring.tick(stiffness, damping)
    zoomSpring.tick(stiffness, damping)

    dlite.mapbox.setCenter(centerSpring.getCurrentValue())
    dlite.mapbox.setBearing(bearingSpring.getCurrentValue())
    dlite.mapbox.setPitch(pitchSpring.getCurrentValue())
    dlite.mapbox.setZoom(zoomSpring.getCurrentValue())
  }

  return { tick, getValues, setValues }
}
