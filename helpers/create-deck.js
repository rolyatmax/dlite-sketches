const { Deck } = require('@deck.gl/core')
const fit = require('canvas-fit')
const mapboxgl = require('mapbox-gl')

module.exports = function createDeck (mapboxToken, center, zoom, bearing, pitch, mapStyle = 'dark', container = window) {
  mapboxgl.accessToken = mapboxToken

  const parentElement = container === window ? document.body : container
  const mapContainer = parentElement.appendChild(document.createElement('div'))
  mapContainer.style.width = '100vw'
  mapContainer.style.height = '100vh'
  mapContainer.style.position = 'fixed'
  mapContainer.style.top = mapContainer.style.left = 0

  const deckCanvas = parentElement.appendChild(document.createElement('canvas'))
  window.addEventListener('resize', fit(deckCanvas, container), false)

  const link = document.head.appendChild(document.createElement('link'))
  link.rel = 'stylesheet'
  link.href = 'https://api.tiles.mapbox.com/mapbox-gl-js/v0.54.0/mapbox-gl.css'

  const mapbox = new mapboxgl.Map({
    container: mapContainer,
    style: `mapbox://styles/mapbox/${mapStyle}-v9`,
    center: center,
    zoom: zoom,
    bearing: bearing,
    pitch: pitch,
    interactive: false
  })

  const onload = new Promise(resolve => {
    mapbox.on('load', resolve)
  })

  const deck = new Deck({
    initialViewState: {
      latitude: center[1],
      longitude: center[0],
      zoom: zoom,
      pitch: pitch,
      bearing: bearing
    },
    controller: true,
    canvas: deckCanvas,
    onViewStateChange: ({ viewState }) => {
      mapbox.jumpTo({
        center: [viewState.longitude, viewState.latitude],
        zoom: viewState.zoom,
        bearing: viewState.bearing,
        pitch: viewState.pitch
      })
    }
  })

  return { deck, mapbox, onload }
}
