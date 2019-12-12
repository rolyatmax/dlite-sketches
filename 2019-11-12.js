// this is used to show JUMP trips - data not included in this repo and is owned by Uber

/* global fetch */

const { GUI } = require('dat.gui')
const { createDlite } = require('./dlite/dlite-0.0.11')
const createLoopToggle = require('./helpers/create-loop')
const { createSpring } = require('spring-animator')

const MAPBOX_TOKEN = require('./mapbox-token')

const DATA_PATH = 'data/jump-trips-directions-sampled.binary'

const MAX_POINTS = 12000000

const viewState = {
  center: [-122.425, 37.78],
  zoom: 13,
  bearing: -35,
  pitch: 60
}
const dlite = createDlite(MAPBOX_TOKEN, viewState)

const settings = {
  opacity: 0.045,
  pointsCount: MAX_POINTS,
  windowStart: 10.5,
  windowSize: 1,
  loopDuration: 6000,
  darkenPow: 1.5,
  lightenOffset: 0.1,
  stiffness: 0.0001,
  dampening: 0.45,
  isRoaming: true,
  animate: true,
  primitive: 'line loop'
}

window.dlite = dlite

fetch(DATA_PATH)
  .then(res => res.arrayBuffer())
  .then(data => {
    const trips = getTripsFromBinary(data)
    console.log(trips.slice(0, 10))

    const toggleLoop = createLoopToggle(render)
    dlite.onload.then(toggleLoop)

    const gui = new GUI()
    gui.add(settings, 'opacity', 0.001, 0.5)
    // gui.add(settings, 'pointsCount', 1, MAX_POINTS).step(1)
    // gui.add(settings, 'windowStart', 0, 23.99).listen()
    gui.add(settings, 'windowSize', 0.01, 12)
    gui.add(settings, 'loopDuration', 1000, 60000, 100)
    gui.add(settings, 'darkenPow', 0, 3)
    gui.add(settings, 'lightenOffset', -0.2, 0.5)
    // gui.add(settings, 'stiffness', 0.0001, 0.1).step(0.0001)
    // gui.add(settings, 'dampening', 0, 1)
    gui.add(settings, 'isRoaming')
    gui.add(settings, 'animate')
    // gui.add(settings, 'primitive', ['points', 'lines', 'line loop', 'triangles', 'triangle strip'])
    gui.add({ setNewCameraPosition }, 'setNewCameraPosition')

    const centerSpring = createSpring(settings.stiffness, settings.dampening, viewState.center)
    const pitchSpring = createSpring(settings.stiffness, settings.dampening, viewState.pitch)
    const bearingSpring = createSpring(settings.stiffness, settings.dampening, viewState.bearing)
    const zoomSpring = createSpring(settings.stiffness, settings.dampening, viewState.zoom)

    function setNewCameraPosition () {
      centerSpring.setDestination(viewState.center.slice().map(v => v + (Math.random() - 0.5) * 0.04))
      pitchSpring.setDestination(Math.random() * 60)
      bearingSpring.setDestination(Math.random() * 180 - 90)
      zoomSpring.setDestination(viewState.zoom + (Math.random() - 0.5) * 2)
    }

    const typedData = getData(trips)

    const texture = dlite.createTexture2D(dlite.gl.drawingBufferWidth, dlite.gl.drawingBufferHeight)
    const framebuffer = dlite.createFramebuffer().colorTarget(0, texture)

    const vertexArray = dlite.picoApp.createVertexArray()
    const positions = dlite.picoApp.createVertexBuffer(dlite.picoApp.gl.FLOAT, 2, typedData.positions)
    const directions = dlite.picoApp.createVertexBuffer(dlite.picoApp.gl.FLOAT, 1, typedData.directions)
    const timestamps = dlite.picoApp.createVertexBuffer(dlite.picoApp.gl.FLOAT, 1, typedData.timestamps)
    const tripDurations = dlite.picoApp.createVertexBuffer(dlite.picoApp.gl.FLOAT, 1, typedData.tripDurations)
    vertexArray.vertexAttributeBuffer(0, positions)
    vertexArray.vertexAttributeBuffer(1, directions)
    vertexArray.vertexAttributeBuffer(2, timestamps)
    vertexArray.vertexAttributeBuffer(4, tripDurations)

    console.log('points count', typedData.timestamps.length)

    const renderPoints = dlite({
      vs: `#version 300 es
      precision highp float;
      layout(location=0) in vec2 position;
      layout(location=1) in float direction;
      layout(location=2) in float timestamp;
      layout(location=4) in float tripDuration;

      uniform float size;
      uniform float opacity;
      uniform float windowStart;
      uniform float windowSize;
      uniform float time;

      out vec4 vFragColor;
      out float vInTimeWindow;

      #define MINUTES_PER_DAY 1440.0
      #define MINUTES_PER_HOUR 60.0
      #define TWO_PI 6.2831853

      #define PURPLE vec3(54, 130, 228) / 255.0
      #define RED vec3(215, 82, 109) / 255.0
      #define ORANGE vec3(254, 164, 37) / 255.0
      #define YELLOW vec3(241, 247, 0) / 255.0

      vec3 getDayHourMinute(float m) {
        float day = floor(m / MINUTES_PER_DAY);
        float hour = floor(mod(m, MINUTES_PER_DAY) / MINUTES_PER_HOUR);
        float minute = floor(mod(mod(m, MINUTES_PER_DAY), MINUTES_PER_HOUR));
        return vec3(day, hour, minute);
      }

      void main() {
        vec3 dayHourMinute = getDayHourMinute(timestamp);
        float day = dayHourMinute[0];
        float hour = dayHourMinute[1];
        float minute = dayHourMinute[2];
        float elapsedHours = hour + minute / 60.0;
        float windowEnd = windowStart + windowSize;
        float windowMiddle = windowStart + windowSize * 0.5;
        if (windowEnd > 24.0 && elapsedHours < windowStart) {
          elapsedHours += 24.0;
        }
        vInTimeWindow = min(smoothstep(windowStart, windowMiddle, elapsedHours), 1.0 - smoothstep(windowMiddle, windowEnd, elapsedHours));

        if (vInTimeWindow == 0.0) {
          gl_PointSize = 0.0;
          gl_Position = vec4(0);
          vFragColor = vec4(0);
        } else {
          vec4 pos = pico_mercator_lngLatToWorld(position);
          gl_Position = pico_mercator_worldToClip(pos);
          gl_PointSize = size * pixelsPerMeter;
          vec3 color;
          if (direction == -1.0) {
            color = vec3(1.0);
          } else {
            float d = direction;
            d += time * 0.0005;
            d = mod(d, TWO_PI);
            float t = d / TWO_PI;
            if (t < 0.33) {
              color = mix(ORANGE, RED, smoothstep(0.0, 0.33, t));
            } else if (t < 0.67) {
              color = mix(RED, PURPLE, smoothstep(0.33, 0.67, t));
            } else {
              color = mix(PURPLE, ORANGE, smoothstep(0.67, 1.0, t));
            }
          }
          vFragColor = vec4(color, opacity);
        }
      }`,

      fs: `#version 300 es
      precision highp float;
      in vec4 vFragColor;
      in float vInTimeWindow;
      out vec4 fragColor;
      void main() {
        if (vInTimeWindow == 0.0) {
          discard;
        }
        fragColor = vFragColor;
      }`,

      vertexArray: vertexArray,
      blend: {
        src: 'src alpha',
        dest: 'one'
      }
    })

    const renderTexture = dlite({
      vertexArray: dlite.createVertexArray()
        .vertexAttributeBuffer(0, dlite.createVertexBuffer(dlite.gl.FLOAT, 2, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]))),
      count: 4,
      primitive: 'triangle fan',
      vs: `#version 300 es
      precision highp float;
      layout(location=0) in vec2 position;
      out vec2 vUV;
      void main() {
        vUV = 0.5 * (1.0 + position);
        gl_Position = vec4(position, 0, 1);
      }
      `,
      fs: `#version 300 es
      precision highp float;
      in vec2 vUV;
      out vec4 fragColor;
      uniform sampler2D uTexture;
      uniform float darkenPow;
      uniform float lightenOffset;
      void main() {
        vec3 rgb = texture(uTexture, vUV).rgb;
        rgb = vec3(
          pow(rgb.r, darkenPow),
          pow(rgb.g, darkenPow),
          pow(rgb.b, darkenPow)
        ) + lightenOffset;
        fragColor = vec4(rgb, 1);
      }
      `,
      blend: false
    })

    function render (t) {
      if (settings.animate) {
        settings.windowStart = (t % settings.loopDuration) / settings.loopDuration * 24
      }

      if (settings.isRoaming) {
        centerSpring.tick(settings.stiffness, settings.dampening)
        pitchSpring.tick(settings.stiffness, settings.dampening)
        bearingSpring.tick(settings.stiffness, settings.dampening)
        zoomSpring.tick(settings.stiffness, settings.dampening)

        const center = centerSpring.getCurrentValue()
        const pitch = pitchSpring.getCurrentValue()
        const bearing = bearingSpring.getCurrentValue()
        const zoom = zoomSpring.getCurrentValue()

        dlite.mapbox.setCenter(center)
        dlite.mapbox.setBearing(bearing)
        dlite.mapbox.setPitch(pitch)
        dlite.mapbox.setZoom(zoom)
      }

      renderPoints({
        clear: [0.13, 0.13, 0.13, 1],
        framebuffer: framebuffer,
        count: settings.pointsCount,
        primitive: settings.primitive,
        uniforms: {
          opacity: settings.opacity,
          windowStart: settings.windowStart,
          windowSize: settings.windowSize,
          time: t
        }
      })

      renderTexture({
        clear: [0.13, 0.13, 0.13, 1],
        uniforms: {
          darkenPow: settings.darkenPow,
          lightenOffset: settings.lightenOffset,
          uTexture: texture,
          dimensions: [dlite.gl.drawingBufferWidth, dlite.gl.drawingBufferHeight]
        }
      })
    }
  })

// Trip Binary data: 32FloatArray with the following values
// trajectory length
// pt1 minutesOfWeek
// pt1 direction (radians)
// pt1 longitude
// pt1 latitude
// pt2 minutesOfWeek
// pt2 direction
// pt2 longitude
// pt2 latitude
function getTripsFromBinary (binaryData) {
  const POINT_DATA_SIZE = 4 // number of 32-bit values for each point's metadata
  const VALUE_BYTES = 4 // 32-bit floats are 4 bytes
  const floats = new Float32Array(binaryData)
  const trips = []
  let j = 0
  while (j < floats.length) {
    const pathLength = floats[j++]
    const pathData = new Float32Array(floats.buffer, j * VALUE_BYTES, pathLength * POINT_DATA_SIZE)
    const tripPath = []
    const tripDirections = []
    const tripTimestamps = []
    for (let i = 0; i < pathData.length; i += POINT_DATA_SIZE) {
      const minutesOfWeek = floats[j + i]
      const direction = floats[j + i + 1]
      const position = new Float32Array(floats.buffer, (j + i + 2) * VALUE_BYTES, 2)
      tripPath.push(position)
      tripDirections.push(direction)
      tripTimestamps.push(minutesOfWeek)
    }
    // making all these even-numbered to help clean up the GL.LINES / GL.TRIANGLES rendering
    while (tripPath.length % 2 !== 0 || tripPath.length % 3 !== 0) {
      tripPath.push(tripPath[tripPath.length - 1])
      tripDirections.push(tripDirections[tripDirections.length - 1])
      tripTimestamps.push(tripTimestamps[tripTimestamps.length - 1])
    }
    trips.push({ path: tripPath, directions: tripDirections, timestamps: tripTimestamps })
    j += pathLength * POINT_DATA_SIZE
  }
  return trips
}

function getData (trips) {
  const positionsData = new Float32Array(MAX_POINTS * 2)
  const directionsData = new Float32Array(MAX_POINTS)
  const timestampsData = new Float32Array(MAX_POINTS)
  const tripDurationsData = new Float32Array(MAX_POINTS)

  let curTrip = 0
  let curPt = 0
  let i = 0
  let j = 0
  let k = 0
  let n = 0
  while (i < positionsData.length && curTrip < trips.length) {
    positionsData[i++] = trips[curTrip].path[curPt][0]
    positionsData[i++] = trips[curTrip].path[curPt][1]
    directionsData[j++] = trips[curTrip].directions[curPt]
    timestampsData[k++] = trips[curTrip].timestamps[curPt]
    tripDurationsData[n++] = trips[curTrip].timestamps[curPt] - trips[curTrip].minutesOfWeek

    curPt += 1
    if (trips[curTrip].path.length === curPt) {
      curPt = 0
      curTrip += 1
    }
  }
  return {
    positions: positionsData,
    directions: directionsData,
    timestamps: timestampsData,
    tripDurations: tripDurationsData
  }
}
