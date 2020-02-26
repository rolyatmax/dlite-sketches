/* global fetch */

const { GUI } = require('dat.gui')
const { createDlite } = require('./dlite/dlite-0.0.10')
const createLoopToggle = require('./helpers/create-loop')
const { createSpring } = require('spring-animator')

const MAPBOX_TOKEN = require('./mapbox-token')
const MAPBOX_STYLE = 'mapbox://styles/taylorbaldwin/cjzm1marw0ef51ct82rd5gt60'

const DATA_PATH = 'data/nyc-highway-nodes.binary'

const viewState = {
  center: [-73.9876, 40.7543],
  zoom: 12,
  bearing: 0,
  pitch: 0
}
const dlite = createDlite(MAPBOX_TOKEN, viewState, MAPBOX_STYLE)

const settings = {
  opacity: 0.5,
  pointSize: 1
}

window.dlite = dlite

fetch(DATA_PATH).then(res => res.arrayBuffer()).then((data) => {
  const lnglats = new Float32Array(data)

  const toggleLoop = createLoopToggle(render)
  dlite.onload.then(toggleLoop)

  const gui = new GUI()
  gui.add(settings, 'opacity', 0.01, 1)
  gui.add(settings, 'pointSize', 0.01, 3)

  const drawPoints = dlite({
    vertexArray: dlite.createVertexArray()
      .vertexAttributeBuffer(0, dlite.createVertexBuffer(dlite.gl.FLOAT, 2, lnglats)),
    vs: `#version 300 es
    precision highp float;
    layout(location=0) in vec2 lnglat;
    uniform float pointSize;
    void main() {
      gl_PointSize = pointSize;
      gl_Position = pico_mercator_lngLatToClip(lnglat);
    }`,
    fs: `#version 300 es
    precision highp float;
    out vec4 fragColor;
    uniform float opacity;
    void main() {
      fragColor = vec4(0.5, 0.6, 0.7, opacity);
    }
    `,
    count: lnglats.length / 2,
    primitive: 'points'
  })

  function render (t) {
    dlite.clear(0, 0, 0, 0)

    drawPoints({
      uniforms: {
        pointSize: settings.pointSize,
        opacity: settings.opacity
      }
    })
  }
})

// ----------------------------------------------------

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
