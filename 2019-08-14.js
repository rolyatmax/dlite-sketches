/* global fetch */

const { GUI } = require('dat.gui')
const createDlite = require('./dlite/dlite-0.0.1')
const createLoopToggle = require('./helpers/create-loop')

const MAPBOX_TOKEN = require('./mapbox-token')

const DATA_PATH = 'data/cabspotting-test.binary'

const MAX_POINTS = 8000000

const dlite = createDlite(MAPBOX_TOKEN, {
  center: [-122.423175, 37.778316],
  zoom: 14,
  bearing: 0,
  pitch: 15
})

const settings = {
  opacity: 1,
  pointsCount: 4000000,
  radius: 5,
  windowStart: 10.5,
  windowSize: 1.5,
  loopDuration: 5000,
  tripType: 'occupied',
  dayType: 'weekday',
  animate: true
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
    gui.add(settings, 'radius', 1, 60)
    gui.add(settings, 'opacity', 0, 1)
    gui.add(settings, 'pointsCount', 1, MAX_POINTS).step(1)
    gui.add(settings, 'dayType', ['weekday', 'weekend'])
    gui.add(settings, 'tripType', ['occupied', 'vacant'])
    gui.add(settings, 'windowStart', 0, 23.99).listen()
    gui.add(settings, 'windowSize', 0.01, 12)
    gui.add(settings, 'loopDuration', 1000, 60000, 100)
    gui.add(settings, 'animate')

    const typedData = getData(trips)

    const vertexArray = dlite.pico.createVertexArray()
    const positions = dlite.pico.createVertexBuffer(dlite.pico.gl.FLOAT, 2, typedData.positions)
    const directions = dlite.pico.createVertexBuffer(dlite.pico.gl.FLOAT, 1, typedData.directions)
    const timestamps = dlite.pico.createVertexBuffer(dlite.pico.gl.FLOAT, 1, typedData.timestamps)
    const occupancies = dlite.pico.createVertexBuffer(dlite.pico.gl.FLOAT, 1, typedData.occupancies)
    vertexArray.vertexAttributeBuffer(0, positions)
    vertexArray.vertexAttributeBuffer(1, directions)
    vertexArray.vertexAttributeBuffer(2, timestamps)
    vertexArray.vertexAttributeBuffer(3, occupancies)

    const renderPoints = dlite({
      vs: `#version 300 es
      precision highp float;
      layout(location=0) in vec2 position;
      layout(location=1) in float direction;
      layout(location=2) in float timestamp;
      layout(location=3) in float occupied;

      uniform float size;
      uniform float opacity;
      uniform float windowStart;
      uniform float windowSize;
      uniform bool showWeekend;
      uniform bool showOccupied;

      out vec4 vFragColor;
      out float vInTimeWindow;

      #define MINUTES_PER_DAY 1440.0
      #define MINUTES_PER_HOUR 60.0
      #define TWO_PI 6.2831853

      vec3 getDayHourMinute(float m) {
        float day = floor(m / MINUTES_PER_DAY);
        float hour = floor(mod(m, MINUTES_PER_DAY) / MINUTES_PER_HOUR);
        float minute = floor(mod(mod(m, MINUTES_PER_DAY), MINUTES_PER_HOUR));
        return vec3(day, hour, minute);
      }

      vec3 hsv2rgb(vec3 c) {
        vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
        vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
        return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
      }

      void main() {
        vec3 dayHourMinute = getDayHourMinute(timestamp);
        float day = dayHourMinute[0];
        float hour = dayHourMinute[1];
        float minute = dayHourMinute[2];
        vInTimeWindow = 0.0;
        bool isOccupied = occupied == 1.0;
        if (day > 4.0 == showWeekend && isOccupied == showOccupied) {
          vInTimeWindow = 1.0;
        }
        float elapsedHours = hour + minute / 60.0;
        float windowEnd = windowStart + windowSize;
        float windowMiddle = windowStart + windowSize * 0.5;
        if (windowEnd > 24.0 && elapsedHours < windowStart) {
          elapsedHours += 24.0;
        }
        vInTimeWindow *= min(smoothstep(windowStart, windowMiddle, elapsedHours), 1.0 - smoothstep(windowMiddle, windowEnd, elapsedHours));

        if (vInTimeWindow == 0.0) {
          gl_PointSize = 0.0;
          gl_Position = vec4(0);
          vFragColor = vec4(0);
        } else {
          vec3 pos = vec3(position, 0.0);
          vec3 offset = vec3(0.0);
          gl_Position = project_position_to_clipspace(pos, offset);
          gl_PointSize = project_size(size);
          vec3 color;
          if (direction == -1.0) {
            color = vec3(1.0);
          } else {
            color = hsv2rgb(vec3(direction / TWO_PI, 0.5, 0.6));
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
      primitive: dlite.pico.gl.POINTS,
      count: settings.pointsCount,
      uniforms: {
        size: settings.radius,
        opacity: settings.opacity,
        windowStart: settings.windowStart,
        windowSize: settings.windowSize,
        showWeekend: settings.dayType === 'weekend',
        showOccupied: settings.tripType === 'occupied'
      }
    })

    function render (t) {
      dlite.clear(0, 0, 0, 0)

      if (settings.animate) {
        settings.windowStart = (t % settings.loopDuration) / settings.loopDuration * 24
      }

      renderPoints({
        count: settings.pointsCount,
        primitive: dlite.pico.gl.POINTS,
        uniforms: {
          size: settings.radius,
          opacity: settings.opacity,
          windowStart: settings.windowStart,
          windowSize: settings.windowSize,
          showWeekend: settings.dayType === 'weekend',
          showOccupied: settings.tripType === 'occupied'
        }
      })
    }
  })

// Trip Binary data: 32FloatArray with the following values
// cab id
// trajectory length
// pt1 minutesOfWeek
// pt1 occupied (boolean)
// pt1 direction (radians)
// pt1 longitude
// pt1 latitude
// pt2 minutesOfWeek
// pt2 occupied
// pt2 direction
// pt2 longitude
// pt2 latitude
function getTripsFromBinary (binaryData) {
  const POINT_DATA_SIZE = 5 // number of 32-bit values for each point's metadata
  const VALUE_BYTES = 4 // 32-bit floats are 4 bytes
  const floats = new Float32Array(binaryData)
  const trips = []
  let j = 0
  while (j < floats.length) {
    const id = floats[j++]
    const pathLength = floats[j++]
    const pathData = new Float32Array(floats.buffer, j * VALUE_BYTES, pathLength * POINT_DATA_SIZE)
    for (let i = 0; i < pathData.length; i += POINT_DATA_SIZE) {
      const minutesOfWeek = floats[j + i]
      const occupied = floats[j + i + 1] === 1
      const direction = floats[j + i + 2]
      const position = new Float32Array(floats.buffer, (j + i + 3) * VALUE_BYTES, 2)

      const minutesOfDay = minutesOfWeek % (24 * 60)
      const isWeekday = minutesOfWeek < 5 * 24 * 60

      let lastTrip = trips[trips.length - 1]
      if (!trips.length || lastTrip.cabId !== id || lastTrip.occupied !== occupied) {
        lastTrip = { cabId: id, path: [], directions: [], timestamps: [], occupied, minutesOfDay, isWeekday }
        trips.push(lastTrip)
      }
      lastTrip.path.push(position)
      lastTrip.directions.push(direction)
      lastTrip.timestamps.push(minutesOfWeek)
    }
    j += pathLength * POINT_DATA_SIZE
  }
  return trips
}

function getData (trips) {
  const positionsData = new Float32Array(MAX_POINTS * 2)
  const directionsData = new Float32Array(MAX_POINTS)
  const timestampsData = new Float32Array(MAX_POINTS)
  const occupanciesData = new Float32Array(MAX_POINTS)

  let curTrip = 0
  let curPt = 0
  let i = 0
  let j = 0
  let k = 0
  let m = 0
  while (i < positionsData.length && curTrip < trips.length) {
    positionsData[i++] = trips[curTrip].path[curPt][0]
    positionsData[i++] = trips[curTrip].path[curPt][1]
    directionsData[j++] = trips[curTrip].directions[curPt]
    timestampsData[k++] = trips[curTrip].timestamps[curPt]
    occupanciesData[m++] = trips[curTrip].occupied ? 1 : 0

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
    occupancies: occupanciesData
  }
}
