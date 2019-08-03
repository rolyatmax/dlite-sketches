// TODO:
// * create a draw call with Pico - target array-drawing and instance-drawing first
// * pull in mercator viewport code (and possibly the View class code from Deck) and pull
// out the logic that can give us the uniforms from just { center, zoom, bearing, pitch }
// as a pure function
// * actually try this code out

const PicoGL = require('picogl')
const fit = require('canvas-fit')
const mapboxgl = require('mapbox-gl')
const mat4 = require('gl-mat4')
const vec4 = require('gl-vec4')

module.exports = function createDlite (mapboxToken, initialViewState, mapStyle = 'dark', container = window) {
  mapboxgl.accessToken = mapboxToken

  const { center, zoom, bearing, pitch } = initialViewState

  const parentElement = container === window ? document.body : container
  const mapContainer = parentElement.appendChild(document.createElement('div'))
  mapContainer.style.width = '100vw'
  mapContainer.style.height = '100vh'
  mapContainer.style.position = 'fixed'
  mapContainer.style.top = mapContainer.style.left = 0

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
    interactive: true
  })

  const onload = new Promise(resolve => {
    mapbox.on('load', resolve)
  })

  const dliteCanvas = parentElement.appendChild(document.createElement('canvas'))
  window.addEventListener('resize', fit(dliteCanvas, container), false)

  const pico = PicoGL.createApp(dliteCanvas)

  function getCameraUniforms () {
    // take viewState from mapbox and pass to mercator viewport functions
    // to get back uniforms
  }

  // create canvas and mercator projection "viewport"
  // make sure the gl canvas has no click events so mapbox can control the viewState
  // create a getCameraUniforms

  function dlite ({ vs, fs, uniforms, attributes, primitive, count, instanceCount, parameters }) {
    // merge in projection uniforms and fns GLSL to vs (and fs?) before compiling program

    // can pass in any updates to draw call EXCEPT vs and fs changes
    return function render (renderOpts) {
      const { uniforms, attributes, primitive, count, instanceCount, parameters } = renderOpts

      const cameraUniforms = getCameraUniforms()
      uniforms = {
        ...cameraUniforms,
        ...uniforms
      }

      // if new attributes, create a new drawCall
    }
  }

  dlite.mapbox = mapbox
  dlite.onload = onload
  // dlite.gl = dliteGl
  // dlite.pico ??? merge pico fns with the dlite object?
  // todo: include project / unproject functions from mercator projection
  // dlite.project
  // dlite.unproject
  return dlite
}

const PROJECTION_GLSL = `
uniform mat4 project_uModelMatrix;
uniform mat4 project_uViewProjectionMatrix;
uniform vec4 project_uCenter;
uniform vec3 project_uCommonUnitsPerMeter;
uniform vec3 project_uCoordinateOrigin;
uniform vec3 project_uCommonUnitsPerWorldUnit;
uniform vec3 project_uCommonUnitsPerWorldUnit2;
uniform float project_uCoordinateSystem;
uniform float project_uScale;
uniform float project_uAntimeridian;
uniform bool project_uWrapLongitude;

const float COORDINATE_SYSTEM_LNG_LAT = 1.;
const float COORDINATE_SYSTEM_LNGLAT_AUTO_OFFSET = 4.;
const float TILE_SIZE = 512.0;
const float PI = 3.1415926536;
const float WORLD_SCALE = TILE_SIZE / (PI * 2.0);

float project_size(float meters) {
  return meters * project_uCommonUnitsPerMeter.z;
}

vec4 project_position_to_clipspace(vec3 position, vec3 offset) {
  vec4 projectedPosition = project_position(vec4(position, 1.0));
  vec4 commonPosition = vec4(projectedPosition.xyz + offset, 1.0);
  return project_uViewProjectionMatrix * position + project_uCenter;
}

vec4 project_position(vec4 position) {
  if (project_uCoordinateSystem == COORDINATE_SYSTEM_LNG_LAT) {
    return project_uModelMatrix * vec4(
      project_mercator_(position.xy) * WORLD_SCALE * project_uScale, project_size(position.z), position.w
    );
  }
  if (project_uCoordinateSystem == COORDINATE_SYSTEM_LNGLAT_AUTO_OFFSET) {
    float X = position.x - project_uCoordinateOrigin.x;
    float Y = position.y - project_uCoordinateOrigin.y;
    return project_offset_(vec4(X, Y, position.z, position.w));
  }
}

vec2 project_mercator_(vec2 lnglat) {
  float x = lnglat.x;
  if (project_uWrapLongitude) {
    x = mod(x - project_uAntimeridian, 360.0) + project_uAntimeridian;
  }
  return vec2(
    radians(x) + PI, PI - log(tan_fp32(PI * 0.25 + radians(lnglat.y) * 0.5))
  );
}

vec4 project_offset_(vec4 offset) {
  float dy = clamp(dy, -1., 1.);
  vec3 commonUnitsPerWorldUnit = project_uCommonUnitsPerWorldUnit + project_uCommonUnitsPerWorldUnit2 * dy;
  return vec4(offset.xyz * commonUnitsPerWorldUnit, offset.w);
}
`

// figure out a way to take the functions in this class and make them stateless
// so we can pass these values in on every frame instead of creating a new class
// instance with these values on each frame
function createWebMercatorViewport () {
  return new WebMercatorViewport({
    altitude: 1.5, // where does this come from?
    bearing: 0,
    height: 652,
    latitude: 37.778316,
    longitude: -122.42317500000003,
    pitch: 0,
    position: [0, 0, 0], // where does this come from?
    width: 1374,
    zoom: 13,

    far: 1000, // where does this come from?
    fovy: 50, // where does this come from?
    modelMatrix: null, // where does this come from?
    near: 0.1, // where does this come from?
    projectionMatrix: null, // where does this come from?

    x: 0,
    y: 0
  })
}

// -------------------------------

// To quickly set a vector to zero
const ZERO_VECTOR = [0, 0, 0, 0]
// 4x4 matrix that drops 4th component of vector
const VECTOR_TO_POINT_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]
const IDENTITY_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const DEFAULT_PIXELS_PER_UNIT2 = [0, 0, 0]
const DEFAULT_COORDINATE_ORIGIN = [0, 0, 0]

// Based on viewport-mercator-project/test/fp32-limits.js
const LNGLAT_AUTO_OFFSET_ZOOM_THRESHOLD = 12

const PROJECT_COORDINATE_SYSTEM = {
  LNG_LAT: 1,
  LNGLAT_AUTO_OFFSET: 4
}

function calculateMatrixAndOffset ({
  viewport,
  coordinateOrigin,
  coordinateZoom
}) {
  const { viewMatrixUncentered } = viewport
  let { viewMatrix } = viewport
  const { projectionMatrix } = viewport
  let { viewProjectionMatrix } = viewport

  let projectionCenter, shaderCoordinateSystem, shaderCoordinateOrigin

  if (coordinateZoom < LNGLAT_AUTO_OFFSET_ZOOM_THRESHOLD) {
    // Use LNG_LAT projection if not zooming
    shaderCoordinateSystem = PROJECT_COORDINATE_SYSTEM.LNG_LAT
    shaderCoordinateOrigin = coordinateOrigin
    shaderCoordinateOrigin[2] = shaderCoordinateOrigin[2] || 0
    projectionCenter = ZERO_VECTOR
  } else {
    shaderCoordinateSystem = PROJECT_COORDINATE_SYSTEM.LNGLAT_AUTO_OFFSET
    const lng = Math.fround(viewport.longitude)
    const lat = Math.fround(viewport.latitude)
    shaderCoordinateOrigin = [lng, lat]
    shaderCoordinateOrigin[2] = shaderCoordinateOrigin[2] || 0

    const positionCommonSpace = viewport.projectPosition(
      shaderCoordinateOrigin,
      Math.pow(2, coordinateZoom)
    )

    positionCommonSpace[3] = 1

    projectionCenter = vec4.transformMat4([], positionCommonSpace, viewProjectionMatrix)

    // Always apply uncentered projection matrix if available (shader adds center)
    viewMatrix = viewMatrixUncentered || viewMatrix

    // Zero out 4th coordinate ("after" model matrix) - avoids further translations
    // viewMatrix = new Matrix4(viewMatrixUncentered || viewMatrix)
    //   .multiplyRight(VECTOR_TO_POINT_MATRIX);
    viewProjectionMatrix = mat4.multiply([], projectionMatrix, viewMatrix)
    viewProjectionMatrix = mat4.multiply([], viewProjectionMatrix, VECTOR_TO_POINT_MATRIX)
  }

  return {
    viewProjectionMatrix,
    projectionCenter,
    shaderCoordinateSystem,
    shaderCoordinateOrigin
  }
}

function getUniformsFromViewport ({
  viewport,
  devicePixelRatio = 1,
  modelMatrix = IDENTITY_MATRIX,
  coordinateOrigin = DEFAULT_COORDINATE_ORIGIN,
  wrapLongitude = false
}) {
  const coordinateZoom = viewport.zoom

  const {
    projectionCenter,
    viewProjectionMatrix,
    shaderCoordinateSystem,
    shaderCoordinateOrigin
  } = calculateMatrixAndOffset({
    coordinateOrigin,
    coordinateZoom,
    viewport
  })

  // Calculate projection pixels per unit
  const distanceScales = viewport.getDistanceScales()
  const uniforms = {
    project_uModelMatrix: modelMatrix || IDENTITY_MATRIX,

    // Projection mode values
    project_uCoordinateSystem: shaderCoordinateSystem,
    project_uCenter: projectionCenter,
    project_uWrapLongitude: wrapLongitude,
    project_uAntimeridian: (viewport.longitude || 0) - 180,

    // Screen size
    // project_uViewportSize: [viewport.width * devicePixelRatio, viewport.height * devicePixelRatio],
    project_uDevicePixelRatio: devicePixelRatio,

    // Distance at which screen pixels are projected
    // project_uFocalDistance: viewport.focalDistance || 1,
    project_uCommonUnitsPerMeter: distanceScales.pixelsPerMeter,
    project_uCommonUnitsPerWorldUnit: distanceScales.pixelsPerMeter,
    project_uCommonUnitsPerWorldUnit2: DEFAULT_PIXELS_PER_UNIT2,
    project_uScale: viewport.scale, // This is the mercator scale (2 ** zoom)

    project_uViewProjectionMatrix: viewProjectionMatrix
  }

  if (shaderCoordinateSystem === PROJECT_COORDINATE_SYSTEM.LNGLAT_AUTO_OFFSET) {
    uniforms.project_uCoordinateOrigin = shaderCoordinateOrigin
  }

  const distanceScalesAtOrigin = viewport.getDistanceScales(shaderCoordinateOrigin)
  uniforms.project_uCommonUnitsPerWorldUnit = distanceScalesAtOrigin.pixelsPerDegree
  uniforms.project_uCommonUnitsPerWorldUnit2 = distanceScalesAtOrigin.pixelsPerDegree2

  return uniforms
}
