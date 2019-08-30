/* global fetch */

const { GUI } = require('dat.gui')
const createDlite = require('./dlite/dlite-0.0.3')
const createLoopToggle = require('./helpers/create-loop')

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
  selectedMonth: 0,
  windowSize: 24,
  framesPerMonth: 0.8,
  animate: true,
  primitive: 'lines'
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
  gui.add(settings, 'windowSize', 0, 36)
  gui.add(settings, 'framesPerMonth', 0.1, 5)
  gui.add(settings, 'animate')
  gui.add(settings, 'primitive', ['points', 'lines', 'line loop', 'triangles', 'triangle strip'])

  const typedData = getData(data.routeData, airports)
  const instanceCount = typedData.positions.length / 2

  const vertexArray = dlite.picoApp.createVertexArray()
  const positions = dlite.picoApp.createVertexBuffer(dlite.picoApp.gl.FLOAT, 2, typedData.positions)
  const timestamps = dlite.picoApp.createVertexBuffer(dlite.picoApp.gl.FLOAT, 2, typedData.timestamps)
  const counts = dlite.picoApp.createVertexBuffer(dlite.picoApp.gl.FLOAT, 3, typedData.counts)
  vertexArray.vertexAttributeBuffer(0, positions)
  vertexArray.vertexAttributeBuffer(1, timestamps)
  vertexArray.vertexAttributeBuffer(2, counts)

  const renderPoints = dlite({
    vs: `#version 300 es
    precision highp float;
    layout(location=0) in vec2 position;
    layout(location=1) in vec2 timestamp;
    layout(location=2) in vec3 counts;

    uniform float opacity;
    uniform float size;
    uniform float scaleDiv;
    uniform float selectedMonth;
    uniform float windowSize;

    out vec4 vFragColor;

    #define PURPLE vec3(61, 72, 139) / 255.0
    #define BLUE vec3(31, 130, 143) / 255.0
    #define YELLOW vec3(226, 230, 0) / 255.0

    void main() {
      gl_Position = project_position_to_clipspace(vec3(position, 0));
      gl_PointSize = project_size(size);

      float availableCapacity = (counts.y - counts.x) / counts.y;
      vec3 c;
      if (availableCapacity < 0.5) {
        c = mix(PURPLE, BLUE, smoothstep(0.3, 0.5, availableCapacity));
      } else {
        c = mix(BLUE, YELLOW, smoothstep(0.5, 0.7, availableCapacity));
      }

      float y = timestamp.x;
      float m = timestamp.y;
      float month = (y - 1990.0) * 12.0 + m;

      float t = min(
        smoothstep(selectedMonth - windowSize, selectedMonth, month),
        1.0 - smoothstep(selectedMonth, selectedMonth + windowSize, month)
      );

      vFragColor = vec4(c, opacity * t);
    }`,

    fs: `#version 300 es
    precision highp float;
    in vec4 vFragColor;
    out vec4 fragColor;
    void main() {
      fragColor = vFragColor;
    }`,

    vertexArray: vertexArray,
    blend: {
      csrc: dlite.picoApp.gl.SRC_ALPHA,
      asrc: dlite.picoApp.gl.SRC_ALPHA,
      cdest: dlite.picoApp.gl.ONE,
      adest: dlite.picoApp.gl.ONE,
      // csrc: dlite.picoApp.gl.SRC_ALPHA,
      // cdest: dlite.picoApp.gl.ONE_MINUS_SRC_ALPHA,
      // asrc: dlite.picoApp.gl.ONE,
      // adest: dlite.picoApp.gl.ONE_MINUS_SRC_ALPHA
    }
  })

  const timestampDiv = document.body.appendChild(document.createElement('div'))
  timestampDiv.style.position = 'fixed'
  timestampDiv.style.bottom = '100px'
  timestampDiv.style.right = '100px'
  timestampDiv.style.fontFamily = 'monospace'
  timestampDiv.style.fontSize = '40px'
  timestampDiv.style.color = 'white'

  let frames = 0
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
      count: instanceCount,
      primitive: primitives[settings.primitive],
      uniforms: {
        opacity: settings.opacity,
        size: settings.size,
        // scaleDiv: settings.scaleDiv,
        selectedMonth: settings.selectedMonth,
        windowSize: settings.windowSize / 2
      }
    })
  }
})

function getData (routes, airports) {
  const routeNames = Object.keys(routes)
    .filter(name => airports[routes[name].origin] && airports[routes[name].destination])

  const positions = []
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
      positions.push(origin.longitude, origin.latitude, dest.longitude, dest.latitude)
      timestamps.push(y, m, y, m)
      counts.push(p, s, f, p, s, f)
    }
  }

  return {
    positions: new Float32Array(positions), // vec2 [lng, lat]
    timestamps: new Float32Array(timestamps), // vec2 [year, month]
    counts: new Float32Array(counts) // vec3 [passengers, seats, flights]
  }
}
