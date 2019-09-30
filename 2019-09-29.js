/* global fetch */

const { GUI } = require('dat.gui')
const { createDlite } = require('./dlite/dlite-0.0.7')
const createLoopToggle = require('./helpers/create-loop')
const { createSpring } = require('spring-animator')

const MAPBOX_TOKEN = require('./mapbox-token')
const MAPBOX_STYLE = 'mapbox://styles/taylorbaldwin/cjzm1marw0ef51ct82rd5gt60'

const DATA_PATH = 'dlite-db/data/flights.binary'
const SCHEMA_PATH = 'dlite-db/data/flights-binary-schema.json'

const viewState = {
  center: [-95.496, 39.987],
  zoom: 4,
  bearing: 0,
  pitch: 0
}
const dlite = createDlite(MAPBOX_TOKEN, viewState, MAPBOX_STYLE)

const settings = {
  opacity: 0.5,
  divisor: 180,
  instanceCountPerc: 0.1,
  arcResolution: 40,
  selectedMonth: 0,
  windowSize: 5,
  arcHeight: 0.5,
  framesPerMonth: 0.7,
  framesPerViewState: 2200,
  stiffness: 0.025,
  damping: 0.22,
  animate: true,
  isRoaming: false
}

window.dlite = dlite

const timestampDiv = document.body.appendChild(document.createElement('div'))
timestampDiv.style.position = 'fixed'
timestampDiv.style.bottom = '100px'
timestampDiv.style.right = '100px'
timestampDiv.style.fontFamily = 'monospace'
timestampDiv.style.fontSize = '40px'
timestampDiv.style.color = 'white'

Promise.all([
  fetch(DATA_PATH).then(res => res.arrayBuffer()),
  fetch(SCHEMA_PATH).then(res => res.json())
]).then(([data, schema]) => {
  const toggleLoop = createLoopToggle(render)
  dlite.onload.then(toggleLoop)

  const gui = new GUI()
  gui.add(settings, 'opacity', 0.01, 0.5)
  gui.add(settings, 'divisor', 1, 300)
  gui.add(settings, 'instanceCountPerc', 0, 1).step(0.01)
  gui.add(settings, 'selectedMonth', 0, 240).step(1).listen()
  gui.add(settings, 'windowSize', 0, 120)
  gui.add(settings, 'arcHeight', 0, 2)
  gui.add(settings, 'framesPerMonth', 0.1, 50)
  gui.add(settings, 'framesPerViewState', 1, 3000).step(1)
  gui.add(settings, 'stiffness', 0.0001, 0.1).step(0.0001)
  gui.add(settings, 'damping', 0, 1)
  gui.add(settings, 'animate')
  gui.add(settings, 'isRoaming')
  gui.add({ setNewCameraPosition }, 'setNewCameraPosition')

  const cameraAnimator = createMapboxCameraAnimator(dlite.mapbox, 0.002, 0.22)

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

  const bytesPerVertex = getBytesPerVertex(schema)
  const buffer = dlite.createInterleavedBuffer(bytesPerVertex, data)

  const instanceCount = getRowCount(schema, data)

  const destinationColors = dlite.createVertexBuffer(dlite.gl.FLOAT, 4, new Float32Array(instanceCount * 4), dlite.gl.DYNAMIC_DRAW)
  const emptyColorData = new Float32Array(instanceCount * 4)
  const colorGpuSpring = createGPUSpring(dlite, 4, emptyColorData)

  const updateColorDestState = dlite({
    vertexArray: dlite.createVertexArray()
      .vertexAttributeBuffer(0, buffer, getBufferOptsForColumn(schema, 'timestamps'))
      .vertexAttributeBuffer(1, buffer, getBufferOptsForColumn(schema, 'passengers'))
      .vertexAttributeBuffer(2, buffer, getBufferOptsForColumn(schema, 'seats'))
      .vertexAttributeBuffer(3, buffer, getBufferOptsForColumn(schema, 'flights')),
    vs: `#version 300 es
    precision highp float;
    layout(location=0) in vec2 timestamp;
    layout(location=1) in float passengers;
    layout(location=2) in float seats;
    layout(location=3) in float flights;

    uniform float opacity;
    uniform vec2 timeWindow;
    uniform float divisor;

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

      float seatsPerFlight = flights > 0.0 ? seats / flights : 0.0;

      if (t < 0.001 || passengers == 0.0 || seats == 0.0 || flights == 0.0 || seatsPerFlight > 50.0) {
        vColor = vec4(0);
      } else {
        float dataT = seatsPerFlight / divisor;
        vec3 c;
        if (dataT < 0.5) {
          c = mix(YELLOW, BLUE, smoothstep(0.0, 0.5, dataT));
        } else {
          c = mix(BLUE, PURPLE, smoothstep(0.5, 1.0, dataT));
        }

        vColor = vec4(c, opacity * t);
      }
    }`,
    transform: {
      vColor: destinationColors
    },
    count: instanceCount * settings.instanceCountPerc | 0
  })

  const arcRenderer = createArcRenderer(dlite, {
    origins: [buffer, getBufferOptsForColumn(schema, 'originLocation')],
    destinations: [buffer, getBufferOptsForColumn(schema, 'destinationLocation')],
    originColors: emptyColorData,
    destinationColors: emptyColorData,
    arcHeight: settings.arcHeight,
    arcResolution: settings.arcResolution
  })

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

    updateColorDestState({
      count: instanceCount * settings.instanceCountPerc | 0,
      uniforms: {
        opacity: settings.opacity,
        divisor: settings.divisor,
        timeWindow: new Float32Array([settings.selectedMonth - settings.windowSize / 2, settings.selectedMonth + settings.windowSize / 2])
      }
    })

    colorGpuSpring.tick(
      destinationColors,
      settings.stiffness,
      settings.damping,
      instanceCount * settings.instanceCountPerc | 0
    )

    arcRenderer.render({
      timer: true,
      count: instanceCount * settings.instanceCountPerc | 0,
      arcHeight: arcHeight,
      buffers: {
        originColors: colorGpuSpring.getCurrentValue(),
        destinationColors: colorGpuSpring.getCurrentValue()
      }
    })
  }
})

// ----------------------------------------------------

function createArcRenderer (dlite, {
  origins, // may be a TypedArray, a Pico buffer, or an array with values [buffer, {type, size, stride, offset}]
  destinations, // may be a TypedArray, a Pico buffer, or an array with values [buffer, {type, size, stride, offset}]
  originColors, // may be a TypedArray, a Pico buffer, or an array with values [buffer, {type, size, stride, offset}]
  destinationColors, // may be a TypedArray, a Pico buffer, or an array with values [buffer, {type, size, stride, offset}]
  arcHeight,
  arcResolution
}) {
  const arcInterpolations = new Array(arcResolution).fill().map((_, i) => [
    i / (arcResolution - 1),
    Math.sin(i / (arcResolution - 1) * Math.PI)
  ]).flat()

  const renderVertexArray = dlite.createVertexArray()
    .vertexAttributeBuffer(0, dlite.createVertexBuffer(dlite.gl.FLOAT, 2, new Float32Array(arcInterpolations)))

  setBuffers({ origins, destinations, originColors, destinationColors })

  const renderPoints = dlite({
    vertexArray: renderVertexArray,
    vs: `#version 300 es
    precision highp float;
    layout(location=0) in vec2 arcPosition;
    layout(location=1) in vec3 iOrigin;
    layout(location=2) in vec3 iDestination;
    layout(location=3) in vec4 iOriginColor;
    layout(location=4) in vec4 iDestinationColor;

    uniform float arcHeight;

    out vec4 vColor;
    out float vHeight;

    void main() {
      if (iOriginColor.a < 0.001 && iDestinationColor.a < 0.001) {
        gl_Position = vec4(0);
        vColor = vec4(0);
        vHeight = 0.0;
        return;
      }

      vec4 worldOrigin = pico_mercator_lngLatToWorld(iOrigin);
      vec4 worldDestination = pico_mercator_lngLatToWorld(iDestination);
      float worldDist = distance(worldOrigin.xy, worldDestination.xy);
      vHeight = arcPosition.y * arcHeight * worldDist / 2.0 / pixelsPerMeter;
      vec3 position = mix(iOrigin, iDestination, arcPosition.x);
      position.z += vHeight;
      gl_Position = pico_mercator_worldToClip(pico_mercator_lngLatToWorld(position));

      vColor = mix(iOriginColor, iDestinationColor, arcPosition.x);
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
    uniforms: {
      arcHeight: arcHeight
    },
    count: arcResolution,
    primitive: dlite.gl.LINE_LOOP,
    blend: {
      csrc: dlite.gl.SRC_ALPHA,
      asrc: dlite.gl.SRC_ALPHA,
      cdest: dlite.gl.ONE,
      adest: dlite.gl.ONE
    }
  })

  return { render, setBuffers }

  function setBuffers ({ origins, destinations, originColors, destinationColors }) {
    if (origins) {
      let originsBuffer, originsAttributeOptions
      if (isTypedArray(origins)) {
        originsBuffer = dlite.createVertexBuffer(dlite.gl.FLOAT, 3, origins)
        originsAttributeOptions = undefined
      } else if (Array.isArray(origins)) {
        originsBuffer = origins[0]
        originsAttributeOptions = origins[1]
      } else {
        originsBuffer = origins
        originsAttributeOptions = undefined
      }
      renderVertexArray.instanceAttributeBuffer(1, originsBuffer, originsAttributeOptions)
    }

    if (destinations) {
      let destinationsBuffer, destinationsAttributeOptions
      if (isTypedArray(destinations)) {
        destinationsBuffer = dlite.createVertexBuffer(dlite.gl.FLOAT, 3, destinations)
        destinationsAttributeOptions = undefined
      } else if (Array.isArray(destinations)) {
        destinationsBuffer = destinations[0]
        destinationsAttributeOptions = destinations[1]
      } else {
        destinationsBuffer = destinations
        destinationsAttributeOptions = undefined
      }
      renderVertexArray.instanceAttributeBuffer(2, destinationsBuffer, destinationsAttributeOptions)
    }

    if (originColors) {
      let originColorsBuffer, originColorsAttributeOptions
      if (isTypedArray(originColors)) {
        originColorsBuffer = dlite.createVertexBuffer(dlite.gl.FLOAT, 4, originColors)
        originColorsAttributeOptions = undefined
      } else if (Array.isArray(originColors)) {
        originColorsBuffer = originColors[0]
        originColorsAttributeOptions = originColors[1]
      } else {
        originColorsBuffer = originColors
        originColorsAttributeOptions = undefined
      }
      renderVertexArray.instanceAttributeBuffer(3, originColorsBuffer, originColorsAttributeOptions)
    }

    if (destinationColors) {
      let destinationColorsBuffer, destinationColorsAttributeOptions
      if (isTypedArray(destinationColors)) {
        destinationColorsBuffer = dlite.createVertexBuffer(dlite.gl.FLOAT, 4, destinationColors)
        destinationColorsAttributeOptions = undefined
      } else if (Array.isArray(destinationColors)) {
        destinationColorsBuffer = destinationColors[0]
        destinationColorsAttributeOptions = destinationColors[1]
      } else {
        destinationColorsBuffer = destinationColors
        destinationColorsAttributeOptions = undefined
      }
      renderVertexArray.instanceAttributeBuffer(4, destinationColorsBuffer, destinationColorsAttributeOptions)
    }
  }

  function render ({ arcHeight, buffers, count, timer }) {
    const renderOpts = {}
    if (arcHeight !== undefined) renderOpts.uniforms = { arcHeight: arcHeight }
    if (count !== undefined) renderOpts.instanceCount = count
    if (timer !== undefined) renderOpts.timer = timer
    if (buffers !== undefined) setBuffers(buffers)
    return renderPoints(renderOpts)
  }
}

// accepts a rico instance or a dlite instance
function createGPUSpring (rico, size, data, stiffness, damping) {
  const SIZE_TO_TYPE = {
    1: 'float',
    2: 'vec2',
    3: 'vec3',
    4: 'vec4'
  }
  const type = SIZE_TO_TYPE[size]
  const count = data.length / size
  const bufferCycle = createCycler(
    rico.createVertexBuffer(rico.gl.FLOAT, size, data, rico.gl.DYNAMIC_DRAW),
    rico.createVertexBuffer(rico.gl.FLOAT, size, data, rico.gl.DYNAMIC_DRAW),
    rico.createVertexBuffer(rico.gl.FLOAT, size, data, rico.gl.DYNAMIC_DRAW)
  )

  const springStateVertexArray = rico.createVertexArray()

  const updateSpringState = rico({
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
      vNextValue = getNextValue(curValue, prevValue, destValue);
    }`,
    transform: {
      vNextValue: bufferCycle.getNext()
    },
    vertexArray: springStateVertexArray,
    count: count
  })

  return { tick, getCurrentValue }

  function getCurrentValue () {
    return bufferCycle.getCurrent()
  }
  function tick (destinationBuffer, s, d, c, useTimer) {
    springStateVertexArray
      .vertexAttributeBuffer(0, bufferCycle.getPrevious())
      .vertexAttributeBuffer(1, bufferCycle.getCurrent())
      .vertexAttributeBuffer(2, destinationBuffer)
    const updateSpringTimings = updateSpringState({
      timer: useTimer,
      count: Number.isFinite(c) ? c : count,
      uniforms: {
        stiffness: Number.isFinite(s) ? s : stiffness,
        damping: Number.isFinite(d) ? d : damping
      },
      transform: {
        vNextValue: bufferCycle.getNext()
      }
    })
    bufferCycle.rotate()
    return updateSpringTimings
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

function createMapboxCameraAnimator (mapbox, stiffness, damping) {
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

const typesToSize = {
  boolean: 1,
  datetime: 1,
  string: 1,
  float: 1,
  vec2: 2,
  vec3: 3,
  vec4: 4
}
function getBytesPerVertex (schema) {
  return 4 * schema.reduce((totalSize, column) => totalSize + typesToSize[column.dataType], 0)
}

function getRowCount (schema, data) {
  const bytesPerVertex = getBytesPerVertex(schema)
  return data.byteLength / bytesPerVertex
}

function getBufferOptsForColumn (schema, columnName) {
  const stride = getBytesPerVertex(schema)
  let offset = 0
  let size

  for (let i = 0; i < schema.length; i++) {
    const s = typesToSize[schema[i].dataType]
    if (schema[i].name === columnName) {
      size = s
      break
    }
    offset += s * 4
  }

  return { type: dlite.gl.FLOAT, size, stride, offset }
}

function isTypedArray (a) {
  if (a instanceof Int8Array) return true
  if (a instanceof Uint8Array) return true
  if (a instanceof Uint8ClampedArray) return true
  if (a instanceof Int16Array) return true
  if (a instanceof Uint16Array) return true
  if (a instanceof Int32Array) return true
  if (a instanceof Uint32Array) return true
  if (a instanceof Float32Array) return true
  if (a instanceof Float64Array) return true
  if (a instanceof BigInt64Array) return true
  if (a instanceof BigUint64Array) return true
  return false
}
