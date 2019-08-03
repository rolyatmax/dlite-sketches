/* global fetch */

const { ScatterplotLayer, PathLayer } = require('@deck.gl/layers')
const { GUI } = require('dat.gui')
const d3 = require('d3')
const createDeck = require('./helpers/create-deck')
const createLoopToggle =  require('./helpers/create-loop')
const { createSpring } = require('spring-animator')

const MAPBOX_TOKEN = require('./mapbox-token')

const DATA_PATH = 'data/cabspotting.binary'

// OUTPUTS: 32FloatArray with the following values
// cab id
// trajectory length
// pt1 minutesOfWeek
// pt1 occupied (boolean)
// pt1 longitude
// pt1 latitude
// pt2 minutesOfWeek
// pt2 occupied
// pt2 longitude
// pt2 latitude

const CENTER = [-122.423175, 37.778316]
const ZOOM = 12
const BEARING = 0
const PITCH = 15

const { deck, mapbox, onload } = createDeck(MAPBOX_TOKEN, CENTER, ZOOM, BEARING, PITCH)

const settings = {
  opacity: 0.02,
  lineWidth: 3,
  tripsCount: 100000,
  showPaths: false,
  showPuDo: true,
  puDo: 'pickups',
  radius: 15,
  color: 'timeOfDay',
  tripSampleRate: 0.5,
  heightMultiplier: 0,
  stiffness: 0.0001,
  dampening: 0.3,
  framesPerViewState: 600,
  isRoaming: false
}

window.deck = deck
console.log(deck)

fetch(DATA_PATH)
  .then(res => res.arrayBuffer())
  .then(data => {
    const floats = new Float32Array(data)

    const trips = []
    let j = 0
    while (j < floats.length) {
      const id = floats[j++]
      const pathLength = floats[j++]
      const pathData = new Float32Array(floats.buffer, j * 4, pathLength * 4)
      for (let i = 0; i < pathData.length; i += 4) {
        const position = Array.from(new Float32Array(floats.buffer, (j + i + 2) * 4, 2))
        const occupied = floats[j + i + 1] === 1
        const minutesOfWeek = floats[j + i]
        const minutesOfDay = minutesOfWeek % (24 * 60)
        const isWeekday = minutesOfWeek < 5 * 24 * 60

        let lastTrip = trips[trips.length - 1]
        if (!trips.length || lastTrip.cabId !== id || lastTrip.occupied !== occupied) {
          lastTrip = { cabId: id, path: [], occupied, minutesOfDay, isWeekday }
          trips.push(lastTrip)
        }
        position[2] = minutesOfDay
        lastTrip.path.push(position)
      }
      j += pathLength * 4
    }

    // console.log(paths[0], paths[0])

    const toggleLoop = createLoopToggle(render)

    const centerSpring = createSpring(settings.stiffness, settings.dampening, CENTER)
    const pitchSpring = createSpring(settings.stiffness, settings.dampening, PITCH)
    const bearingSpring = createSpring(settings.stiffness, settings.dampening, BEARING)
    const zoomSpring = createSpring(settings.stiffness, settings.dampening, ZOOM)
    const heightSpring = createSpring(0.04, 0.48, settings.heightMultiplier)

    let frames = 0
    function setNewCameraPosition () {
      centerSpring.setDestination(CENTER.slice().map(v => v + (Math.random() - 0.5) * 0.1))
      pitchSpring.setDestination(Math.random() * 60)
      bearingSpring.setDestination(Math.random() * 180)
      zoomSpring.setDestination(ZOOM + (Math.random() - 0.5) * 2)
      frames = 0
    }

    function toggleHeight () {
      settings.heightMultiplier = settings.heightMultiplier > 0 ? 0 : 2.5
      heightSpring.setDestination(settings.heightMultiplier)
    }

    const gui = new GUI()
    gui.add(settings, 'opacity', 0.005, 1) // .onChange(render)
    // gui.add(settings, 'tripsCount', 1, trips.length).step(1) // .onChange(render)
    gui.add(settings, 'lineWidth', 1, 20) // .onChange(render)
    gui.add(settings, 'showPaths') // .onChange(render)
    gui.add(settings, 'showPuDo') // .onChange(render)
    gui.add(settings, 'puDo', ['pickups', 'dropoffs']) // .onChange(render)
    gui.add(settings, 'radius', 1, 60) // .onChange(render)
    // gui.add(settings, 'heightMultiplier', 0, 3)
    // gui.add(settings, 'tripSampleRate', 0.01, 1).step(0.01) // .onChange(render)
    gui.add(settings, 'color', ['occupancy', 'dayType', 'timeOfDay']) // .onChange(render)
    gui.add(settings, 'stiffness', 0.0001, 0.1).step(0.0001)
    gui.add(settings, 'dampening', 0, 1)
    gui.add(settings, 'framesPerViewState', 1, 3000).step(1)
    gui.add(settings, 'isRoaming')
    gui.add({ toggleLoop }, 'toggleLoop')
    gui.add({ setNewCameraPosition }, 'setNewCameraPosition')
    gui.add({ toggleHeight }, 'toggleHeight')

    const sampledOccupiedTrips = trips.filter(t => t.occupied && Math.random() < settings.tripSampleRate)
    const limitedTripsForPaths = trips.slice(0, settings.tripsCount)

    onload.then(toggleLoop)

    function render (t) {
      const layers = []
      const props = { layers }

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

        mapbox.setCenter(center)
        mapbox.setBearing(bearing)
        mapbox.setPitch(pitch)
        mapbox.setZoom(zoom)

        props.viewState = {
          longitude: center[0],
          latitude: center[1],
          zoom: zoom,
          bearing: bearing,
          pitch: pitch
        }
      }

      heightSpring.tick()

      let heightMult = heightSpring.getCurrentValue()
      heightMult = heightMult < 0 ? 0 : heightMult

      if (settings.showPaths) {
        layers.push(
          new PathLayer({
            id: 'path-layer',
            data: limitedTripsForPaths,
            pickable: false,
            opacity: settings.opacity,
            getWidth: settings.lineWidth,
            getPath: d => d.path.map(pt => {
              const p = pt.slice()
              p[2] *= heightMult
              return p
            }),
            getColor: getColor,
            updateTriggers: {
              getColor: [settings.color],
              getPath: [heightMult]
            }
          })
        )
      }

      if (settings.showPuDo) {
        layers.push(
          new ScatterplotLayer({
            id: 'scatterplot-layer',
            data: sampledOccupiedTrips,
            pickable: false,
            stroked: false,
            filled: true,
            opacity: settings.opacity,
            getRadius: settings.radius,
            getPosition: d => {
              let pt = settings.puDo === 'pickups' ? d.path[0] : d.path[d.path.length - 1]
              pt = pt.slice()
              pt[2] *= heightMult
              return pt
            },
            getFillColor: getColor,
            updateTriggers: {
              getFillColor: [settings.color],
              getPosition: [heightMult, settings.puDo]
            }
          })
        )
      }

      deck.setProps(props)
    }

    function getColor (d) {
      if (settings.color === 'occupancy') return d.occupied ? [250, 200, 150] : [150, 200, 250]
      if (settings.color === 'dayType') return d.isWeekday ? [255, 255, 200] : [255, 200, 255]
      if (settings.color === 'timeOfDay') {
        const middleOfDay = (60 * 24) / 2
        const t = d.minutesOfDay < middleOfDay ? d.minutesOfDay / middleOfDay : (1 - (d.minutesOfDay - middleOfDay) / middleOfDay)
        const { r, g, b } = d3.rgb(d3.interpolateYlGnBu(1 - t)).rgb()
        return [r, g, b]
      }
      return [200, 200, 100]
    }

  })
