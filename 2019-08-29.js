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
  stiffness: 0.0001,
  damping: 0.3,
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

  const centerSpring = createSpring(settings.stiffness, settings.damping, viewState.center)
  const pitchSpring = createSpring(settings.stiffness, settings.damping, viewState.pitch)
  const bearingSpring = createSpring(settings.stiffness, settings.damping, viewState.bearing)
  const zoomSpring = createSpring(settings.stiffness, settings.damping, viewState.zoom)
  const heightSpring = createSpring(0.01, 0.2, 0)

  let frames = 0
  function setNewCameraPosition () {
    centerSpring.setDestination(viewState.center.slice().map(v => v + (Math.random() - 0.5) * 3))
    pitchSpring.setDestination(Math.random() * 60)
    bearingSpring.setDestination(Math.random() * 120 - 60)
    zoomSpring.setDestination(viewState.zoom + (Math.random() - 0.5) * 3)
    frames = 0
  }

  const arcPositions = new Array(settings.arcResolution).fill().map((_, i) => [
    i / (settings.arcResolution - 1),
    Math.sin(i / (settings.arcResolution - 1) * Math.PI)
  ]).flat()

  const typedData = getData(data.routeData, airports)
  const instanceCount = typedData.origins.length / 2

  const origins = dlite.picoApp.createVertexBuffer(dlite.picoApp.gl.FLOAT, 2, typedData.origins)
  const destinations = dlite.picoApp.createVertexBuffer(dlite.picoApp.gl.FLOAT, 2, typedData.destinations)
  const timestamps = dlite.picoApp.createVertexBuffer(dlite.picoApp.gl.FLOAT, 2, typedData.timestamps)
  const counts = dlite.picoApp.createVertexBuffer(dlite.picoApp.gl.FLOAT, 3, typedData.counts)
  const interpolations = dlite.picoApp.createVertexBuffer(dlite.picoApp.gl.FLOAT, 2, new Float32Array(arcPositions))

  const vColorBuffers = [
    dlite.picoApp.createVertexBuffer(dlite.picoApp.gl.FLOAT, 4, new Float32Array(instanceCount * 4)),
    dlite.picoApp.createVertexBuffer(dlite.picoApp.gl.FLOAT, 4, new Float32Array(instanceCount * 4)),
    dlite.picoApp.createVertexBuffer(dlite.picoApp.gl.FLOAT, 4, new Float32Array(instanceCount * 4))
  ]

  const vHeightBuffers = [
    dlite.picoApp.createVertexBuffer(dlite.picoApp.gl.FLOAT, 1, new Float32Array(instanceCount)),
    dlite.picoApp.createVertexBuffer(dlite.picoApp.gl.FLOAT, 1, new Float32Array(instanceCount)),
    dlite.picoApp.createVertexBuffer(dlite.picoApp.gl.FLOAT, 1, new Float32Array(instanceCount))
  ]

  const renderVertexArray = dlite.picoApp.createVertexArray()
    .vertexAttributeBuffer(0, interpolations)
    .instanceAttributeBuffer(1, origins)
    .instanceAttributeBuffer(2, destinations)
    .instanceAttributeBuffer(3, vColorBuffers[2])
    .instanceAttributeBuffer(4, vHeightBuffers[2])

  const instanceStateVertexArray = dlite.picoApp.createVertexArray()
    .vertexAttributeBuffer(0, origins)
    .vertexAttributeBuffer(1, destinations)
    .vertexAttributeBuffer(2, timestamps)
    .vertexAttributeBuffer(3, counts)
    .vertexAttributeBuffer(4, vColorBuffers[0])
    .vertexAttributeBuffer(5, vColorBuffers[1])
    .vertexAttributeBuffer(6, vHeightBuffers[0])
    .vertexAttributeBuffer(7, vHeightBuffers[1])

  let curBufferIdx = 0
  const updateInstanceState = dlite({
    vs: `#version 300 es
    precision highp float;
    layout(location=0) in vec2 origin;
    layout(location=1) in vec2 destination;
    layout(location=2) in vec2 timestamp;
    layout(location=3) in vec3 counts;
    layout(location=4) in vec4 prevColor;
    layout(location=5) in vec4 curColor;
    layout(location=6) in float prevHeight;
    layout(location=7) in float curHeight;

    uniform float opacity;
    uniform vec2 timeWindow;
    uniform float arcHeight;
    uniform float stiffness;
    uniform float damping;

    out vec4 vColor;
    out float vHeight;

    #define PURPLE vec3(61, 72, 139) / 255.0
    #define BLUE vec3(31, 130, 143) / 255.0
    #define YELLOW vec3(226, 230, 0) / 255.0

    float getNextValue(float cur, float prev, float dest) {
      float velocity = cur - prev;
      float delta = dest - cur;
      float spring = delta * stiffness;
      float damper = velocity * -1.0 * damping;
      return spring + damper + velocity + cur;
    }

    vec4 getNextValue(vec4 cur, vec4 prev, vec4 dest) {
      vec4 velocity = cur - prev;
      vec4 delta = dest - cur;
      vec4 spring = delta * stiffness;
      vec4 damper = velocity * -1.0 * damping;
      return spring + damper + velocity + cur;
    }

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
        vHeight = 0.0;
      } else {
        // HACK: adding this so the compiler doesn't strip out the project_uCenter uniform
        // because PicoGL ends up throwing errors when we try to pass it in but it's been stripped out of the source
        vec4 wastedVar = project_position_to_clipspace(vec3(0));

        vec4 worldOrigin = project_position(vec4(origin, 0, 0));
        vec4 worldDestination = project_position(vec4(destination, 0, 0));
        float worldDist = distance(worldOrigin, worldDestination);
        float meters = 1.0 / project_size(1.0 / worldDist);
  
        vHeight = arcHeight * meters / 2.0 * t;
  
        float availableCapacity = (counts.y - counts.x) / counts.y;
        vec3 c;
        if (availableCapacity < 0.5) {
          c = mix(PURPLE, BLUE, smoothstep(0.3, 0.5, availableCapacity));
        } else {
          c = mix(BLUE, YELLOW, smoothstep(0.5, 0.7, availableCapacity));
        }
  
        vColor = vec4(c, opacity * t);
      }

      // Do the spring stuff here
      vColor = getNextValue(curColor, prevColor, vColor);
      vHeight = getNextValue(curHeight, prevHeight, vHeight);
    }`,

    fs: `#version 300 es
    precision highp float;
    in vec4 vColor;
    in float vHeight;
    out vec4 fragColor;
    void main() {
      fragColor = vec4(0);
    }`,
    transform: {
      vColor: vColorBuffers[(curBufferIdx + 2) % 3],
      vHeight: vHeightBuffers[(curBufferIdx + 2) % 3]
    },
    vertexArray: instanceStateVertexArray,
    count: instanceCount,
    primitive: dlite.picoApp.gl.POINTS
  })

  const renderPoints = dlite({
    vs: `#version 300 es
    precision highp float;
    layout(location=0) in vec2 interpolation;
    layout(location=1) in vec2 iOrigin;
    layout(location=2) in vec2 iDestination;
    layout(location=3) in vec4 iColor;
    layout(location=4) in float iHeight;

    uniform float size;

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

      vec2 delta = (iDestination - iOrigin) * interpolation.x;
      vHeight = iHeight * interpolation.y;
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

    vertexArray: renderVertexArray,
    blend: {
      csrc: dlite.picoApp.gl.SRC_ALPHA,
      asrc: dlite.picoApp.gl.SRC_ALPHA,
      cdest: dlite.picoApp.gl.ONE,
      adest: dlite.picoApp.gl.ONE
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

      centerSpring.tick(settings.stiffness, settings.damping)
      pitchSpring.tick(settings.stiffness, settings.damping)
      bearingSpring.tick(settings.stiffness, settings.damping)
      zoomSpring.tick(settings.stiffness, settings.damping)

      const center = centerSpring.getCurrentValue()
      const pitch = pitchSpring.getCurrentValue()
      const bearing = bearingSpring.getCurrentValue()
      const zoom = zoomSpring.getCurrentValue()

      dlite.mapbox.setCenter(center)
      dlite.mapbox.setBearing(bearing)
      dlite.mapbox.setPitch(pitch)
      dlite.mapbox.setZoom(zoom)
    }

    heightSpring.setDestination(settings.arcHeight)
    heightSpring.tick(0.01, 0.2)
    const arcHeight = heightSpring.getCurrentValue()

    const y = ((settings.selectedMonth / 12) | 0) + 1990
    timestampDiv.innerText = y

    const primitives = {
      points: dlite.picoApp.gl.POINTS,
      lines: dlite.picoApp.gl.LINES,
      'line loop': dlite.picoApp.gl.LINE_LOOP,
      triangles: dlite.picoApp.gl.TRIANGLES,
      'triangle strip': dlite.picoApp.gl.TRIANGLE_STRIP
    }

    renderVertexArray
      .instanceAttributeBuffer(3, vColorBuffers[(curBufferIdx + 2) % 3])
      .instanceAttributeBuffer(4, vHeightBuffers[(curBufferIdx + 2) % 3])

    renderPoints({
      count: settings.arcResolution,
      instanceCount: instanceCount,
      primitive: primitives[settings.primitive],
      uniforms: {
        size: settings.size
      }
    })

    curBufferIdx = (curBufferIdx + 1) % 3
    instanceStateVertexArray
      .vertexAttributeBuffer(4, vColorBuffers[curBufferIdx])
      .vertexAttributeBuffer(5, vColorBuffers[(curBufferIdx + 1) % 3])
      .vertexAttributeBuffer(6, vHeightBuffers[curBufferIdx])
      .vertexAttributeBuffer(7, vHeightBuffers[(curBufferIdx + 1) % 3])

    updateInstanceState({
      transform: {
        vColor: vColorBuffers[(curBufferIdx + 2) % 3],
        vHeight: vHeightBuffers[(curBufferIdx + 2) % 3]
      },
      uniforms: {
        opacity: settings.opacity,
        timeWindow: new Float32Array([settings.selectedMonth - settings.windowSize / 2, settings.selectedMonth + settings.windowSize / 2]),
        arcHeight: arcHeight,
        stiffness: settings.stiffness,
        damping: settings.damping
      }
    })
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
