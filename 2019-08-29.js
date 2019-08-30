/* global fetch */

const { GUI } = require('dat.gui')
const createDlite = require('./dlite/dlite-0.0.3')
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
  scaleDiv: 5000,
  arcResolution: 30,
  selectedMonth: 0,
  windowSize: 24,
  arcHeight: 1,
  framesPerMonth: 0.8,
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
  gui.add(settings, 'scaleDiv', 1, 9000)
  gui.add(settings, 'selectedMonth', 0, 240).step(1).listen()
  gui.add(settings, 'windowSize', 0, 120)
  gui.add(settings, 'arcHeight', 0, 2)
  gui.add(settings, 'framesPerMonth', 0.1, 5)
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

  const vertexArray = dlite.picoApp.createVertexArray()
  const origins = dlite.picoApp.createVertexBuffer(dlite.picoApp.gl.FLOAT, 2, typedData.origins)
  const destinations = dlite.picoApp.createVertexBuffer(dlite.picoApp.gl.FLOAT, 2, typedData.destinations)
  const timestamps = dlite.picoApp.createVertexBuffer(dlite.picoApp.gl.FLOAT, 2, typedData.timestamps)
  const counts = dlite.picoApp.createVertexBuffer(dlite.picoApp.gl.FLOAT, 3, typedData.counts)
  const interpolations = dlite.picoApp.createVertexBuffer(dlite.picoApp.gl.FLOAT, 2, new Float32Array(arcPositions))
  vertexArray.vertexAttributeBuffer(0, interpolations)
  vertexArray.instanceAttributeBuffer(1, origins)
  vertexArray.instanceAttributeBuffer(2, destinations)
  vertexArray.instanceAttributeBuffer(3, timestamps)
  vertexArray.instanceAttributeBuffer(4, counts)

  const renderPoints = dlite({
    vs: `#version 300 es
    precision highp float;
    layout(location=0) in vec2 interpolation;
    layout(location=1) in vec2 origin;
    layout(location=2) in vec2 destination;
    layout(location=3) in vec2 timestamp;
    layout(location=4) in vec3 counts;

    uniform float opacity;
    uniform float size;
    uniform vec2 timeWindow;
    uniform float arcHeight;

    out vec4 vFragColor;
    out float vHeight;

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
        gl_Position = vec4(0);
        gl_PointSize = 0.0;
        vFragColor = vec4(0);
        vHeight = 0.0;
        return;
      }

      vec4 worldOrigin = project_position(vec4(origin, 0, 0));
      vec4 worldDestination = project_position(vec4(destination, 0, 0));
      float worldDist = distance(worldOrigin, worldDestination);
      float meters = 1.0 / project_size(1.0 / worldDist);

      vec2 delta = (destination - origin) * interpolation.x;
      vec3 position = vec3(origin + delta, arcHeight * interpolation.y * meters / 2.0);
      vHeight = interpolation.y;

      gl_Position = project_position_to_clipspace(position);
      gl_PointSize = project_size(size);

      float availableCapacity = (counts.y - counts.x) / counts.y;
      vec3 c;
      if (availableCapacity < 0.5) {
        c = mix(PURPLE, BLUE, smoothstep(0.3, 0.5, availableCapacity));
      } else {
        c = mix(BLUE, YELLOW, smoothstep(0.5, 0.7, availableCapacity));
      }

      vFragColor = vec4(c, opacity * t);
    }`,

    fs: `#version 300 es
    precision highp float;
    in vec4 vFragColor;
    in float vHeight;
    out vec4 fragColor;
    void main() {
      if (vHeight < 0.01 || vFragColor.a < 0.001) {
        discard;
      }
      fragColor = vFragColor;
    }`,

    vertexArray: vertexArray,
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

    renderPoints({
      count: settings.arcResolution,
      instanceCount: instanceCount,
      primitive: primitives[settings.primitive],
      uniforms: {
        opacity: settings.opacity,
        size: settings.size,
        timeWindow: new Float32Array([settings.selectedMonth - settings.windowSize / 2, settings.selectedMonth + settings.windowSize / 2]),
        arcHeight: arcHeight
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
