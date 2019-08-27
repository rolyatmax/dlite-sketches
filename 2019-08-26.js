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
  opacity: 0.15,
  size: 10,
  animate: false,
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
  gui.add(settings, 'opacity', 0, 1)
  gui.add(settings, 'size', 1, 100000)
  gui.add(settings, 'primitive', ['points', 'lines', 'line loop', 'triangles', 'triangle strip'])

  const typedData = getData(data.routeData, airports)
  const instanceCount = typedData.positions.length / 2

  const vertexArray = dlite.picoApp.createVertexArray()
  const positions = dlite.picoApp.createVertexBuffer(dlite.picoApp.gl.FLOAT, 3, typedData.positions)
  vertexArray.vertexAttributeBuffer(0, positions)

  const renderPoints = dlite({
    vs: `#version 300 es
    precision highp float;
    layout(location=0) in vec3 position;

    uniform float opacity;
    uniform float size;

    out vec4 vFragColor;

    #define PURPLE vec3(111, 59, 172) / 255.0
    #define BLUE vec3(44, 143, 228) / 255.0

    void main() {
      gl_Position = project_position_to_clipspace(position);
      gl_PointSize = project_size(size);
      vFragColor = vec4(PURPLE, opacity);
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
      asrc: dlite.picoApp.gl.ONE,
      cdest: dlite.picoApp.gl.DST_ALPHA,
      adest: dlite.picoApp.gl.ONE,
      // csrc: dlite.picoApp.gl.SRC_ALPHA,
      // cdest: dlite.picoApp.gl.ONE_MINUS_SRC_ALPHA,
      // asrc: dlite.picoApp.gl.ONE,
      // adest: dlite.picoApp.gl.ONE_MINUS_SRC_ALPHA
    }
  })

  function render (t) {
    dlite.clear(0, 0, 0, 0)

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
        size: settings.size
      }
    })
  }
})

function getData (routes, airports) {
  const routeNames = Object.keys(routes)
    .filter(name => airports[routes[name].origin] && airports[routes[name].destination])

  const positionsData = new Float32Array(routeNames.length * 2 * 3)

  let i = 0
  for (const name of routeNames) {
    const route = routes[name]
    const origin = airports[route.origin]
    const dest = airports[route.destination]
    positionsData[i++] = origin.longitude
    positionsData[i++] = origin.latitude
    positionsData[i++] = origin.altitude
    positionsData[i++] = dest.longitude
    positionsData[i++] = dest.latitude
    positionsData[i++] = dest.altitude
  }

  return {
    positions: positionsData
  }
}
