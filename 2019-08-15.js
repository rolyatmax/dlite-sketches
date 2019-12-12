/* global fetch */

const { GUI } = require('dat.gui')
const createDlite = require('./dlite/dlite-0.0.3')
const createLoopToggle = require('./helpers/create-loop')
const { createSpring } = require('spring-animator')

const MAPBOX_TOKEN = require('./mapbox-token')

const DATA_PATH = 'data/cabspotting.binary'

const MAX_POINTS = 8000000

const viewState = {
  center: [-122.411, 37.792],
  zoom: 13,
  bearing: -35,
  pitch: 60
}
const dlite = createDlite(MAPBOX_TOKEN, viewState)

const settings = {
  opacity: 0.45,
  pointsCount: 8000000,
  radius: 12,
  windowStart: 10.5,
  windowSize: 3,
  loopDuration: 4000,
  tripType: 'occupied',
  dayType: 'weekday',
  heightMult: 0,
  framesPerViewState: 2200,
  stiffness: 0.0001,
  dampening: 0.3,
  isRoaming: false,
  animate: true,
  primitive: 'points'
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
    gui.add(settings, 'heightMult', 0, 50).step(0.01)
    gui.add(settings, 'framesPerViewState', 1, 3000).step(1)
    gui.add(settings, 'stiffness', 0.0001, 0.1).step(0.0001)
    gui.add(settings, 'dampening', 0, 1)
    gui.add(settings, 'isRoaming')
    gui.add(settings, 'animate')
    gui.add(settings, 'primitive', ['points', 'lines', 'line loop', 'triangles', 'triangle strip'])
    gui.add({ setNewCameraPosition }, 'setNewCameraPosition')

    const centerSpring = createSpring(settings.stiffness, settings.dampening, viewState.center)
    const pitchSpring = createSpring(settings.stiffness, settings.dampening, viewState.pitch)
    const bearingSpring = createSpring(settings.stiffness, settings.dampening, viewState.bearing)
    const zoomSpring = createSpring(settings.stiffness, settings.dampening, viewState.zoom)
    const heightSpring = createSpring(0.01, 0.2, 0)

    let frames = 0
    function setNewCameraPosition () {
      centerSpring.setDestination(viewState.center.slice().map(v => v + (Math.random() - 0.5) * 0.1))
      pitchSpring.setDestination(Math.random() * 60)
      bearingSpring.setDestination(Math.random() * 180 - 90)
      zoomSpring.setDestination(viewState.zoom + (Math.random() - 0.5) * 2)
      frames = 0
    }

    const typedData = getData(trips)

    const vertexArray = dlite.picoApp.createVertexArray()
    const positions = dlite.picoApp.createVertexBuffer(dlite.picoApp.gl.FLOAT, 2, typedData.positions)
    const directions = dlite.picoApp.createVertexBuffer(dlite.picoApp.gl.FLOAT, 1, typedData.directions)
    const timestamps = dlite.picoApp.createVertexBuffer(dlite.picoApp.gl.FLOAT, 1, typedData.timestamps)
    const occupancies = dlite.picoApp.createVertexBuffer(dlite.picoApp.gl.FLOAT, 1, typedData.occupancies)
    const tripDurations = dlite.picoApp.createVertexBuffer(dlite.picoApp.gl.FLOAT, 1, typedData.tripDurations)
    vertexArray.vertexAttributeBuffer(0, positions)
    vertexArray.vertexAttributeBuffer(1, directions)
    vertexArray.vertexAttributeBuffer(2, timestamps)
    vertexArray.vertexAttributeBuffer(3, occupancies)
    vertexArray.vertexAttributeBuffer(4, tripDurations)

    const renderPoints = dlite({
      vs: `#version 300 es
      precision highp float;
      layout(location=0) in vec2 position;
      layout(location=1) in float direction;
      layout(location=2) in float timestamp;
      layout(location=3) in float occupied;
      layout(location=4) in float tripDuration;

      uniform float size;
      uniform float opacity;
      uniform float windowStart;
      uniform float windowSize;
      uniform bool showWeekend;
      uniform bool showOccupied;
      uniform float heightMult;

      out vec4 vFragColor;
      out float vInTimeWindow;

      #define MINUTES_PER_DAY 1440.0
      #define MINUTES_PER_HOUR 60.0
      #define TWO_PI 6.2831853

      #define PURPLE vec3(111, 59, 172) / 255.0
      #define BLUE vec3(44, 143, 228) / 255.0
      #define GREEN vec3(0, 224, 160) / 255.0
      #define YELLOW vec3(162, 243, 75) / 255.0

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
          vec3 pos = vec3(position, tripDuration * heightMult);
          gl_Position = project_position_to_clipspace(pos);
          gl_PointSize = project_size(size);
          vec3 color;
          if (direction == -1.0) {
            color = vec3(1.0);
          } else {
            float t = direction / TWO_PI;
            if (t < 0.25) {
              color = mix(YELLOW, GREEN, smoothstep(0.0, 0.25, t));
            } else if (t < 0.5) {
              color = mix(GREEN, BLUE, smoothstep(0.25, 0.5, t));
            } else if (t < 0.75) {
              color = mix(BLUE, PURPLE, smoothstep(0.5, 0.75, t));
            } else {
              color = mix(PURPLE, YELLOW, smoothstep(0.75, 1.0, t));
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
        vec2 cxy = 2.0 * gl_PointCoord - 1.0;
        float r = dot(cxy, cxy);
        float delta = fwidth(r);
        float alpha = 1.0 - smoothstep(1.0 - delta, 1.0 + delta, r);
        if (r > 0.9) {
          discard;
        }
        fragColor = vFragColor;
        fragColor.a *= alpha;
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

      if (settings.animate) {
        settings.windowStart = (t % settings.loopDuration) / settings.loopDuration * 24
      }

      if (settings.isRoaming) {
        if (frames % settings.framesPerViewState === 0) setNewCameraPosition()
        frames += 1

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

      heightSpring.setDestination(settings.heightMult)
      heightSpring.tick(0.01, 0.2)
      const heightMult = heightSpring.getCurrentValue()

      const primitives = {
        points: dlite.picoApp.gl.POINTS,
        lines: dlite.picoApp.gl.LINES,
        'line loop': dlite.picoApp.gl.LINE_LOOP,
        triangles: dlite.picoApp.gl.TRIANGLES,
        'triangle strip': dlite.picoApp.gl.TRIANGLE_STRIP
      }

      renderPoints({
        count: settings.pointsCount,
        primitive: primitives[settings.primitive],
        uniforms: {
          size: settings.radius,
          opacity: settings.opacity,
          windowStart: settings.windowStart,
          windowSize: settings.windowSize,
          showWeekend: settings.dayType === 'weekend',
          showOccupied: settings.tripType === 'occupied',
          heightMult: heightMult
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
        lastTrip = { cabId: id, path: [], directions: [], timestamps: [], occupied, minutesOfDay, minutesOfWeek, isWeekday }
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
  const tripDurationsData = new Float32Array(MAX_POINTS)

  let curTrip = 0
  let curPt = 0
  let i = 0
  let j = 0
  let k = 0
  let m = 0
  let n = 0
  while (i < positionsData.length && curTrip < trips.length) {
    positionsData[i++] = trips[curTrip].path[curPt][0]
    positionsData[i++] = trips[curTrip].path[curPt][1]
    directionsData[j++] = trips[curTrip].directions[curPt]
    timestampsData[k++] = trips[curTrip].timestamps[curPt]
    occupanciesData[m++] = trips[curTrip].occupied ? 1 : 0
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
    occupancies: occupanciesData,
    tripDurations: tripDurationsData
  }
}
