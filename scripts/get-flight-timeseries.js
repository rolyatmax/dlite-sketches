// expects a tab-separated tsv from stdin with the following columns:
// Origin	Destination	OriginCity	DestinationCity	Passengers	Seats	Flights	Distance	FlyDate	OriginPopulation	DestinationPopulation

const readline = require('readline')

const rl = readline.createInterface({ input: process.stdin })

const timestamps = [null, null]
let maxPassengers = -Infinity
let maxSeats = -Infinity
let maxFlights = -Infinity

const routes = new Set()
const cities = new Set()
let totalEntries = 0

let firstLine = true

const routeData = {}

rl.on('line', (input) => {
  if (!input || firstLine) {
    firstLine = false
    return
  }
  totalEntries += 1
  const [origin, destination, originCity, destCity, passengers, seats, flights, dist, flyDate, originPop, destPop] = input.split(`	`)
  cities.add(origin)
  cities.add(destination)
  const routeName = `${origin}-${destination}`
  routes.add(`${origin}-${destination}`)
  timestamps[0] = timestamps[0] && timestamps[0] < flyDate ? timestamps[0] : flyDate
  timestamps[1] = timestamps[1] && timestamps[1] > flyDate ? timestamps[1] : flyDate
  maxPassengers = Math.max(maxPassengers, parseInt(passengers, 10))
  maxSeats = Math.max(maxSeats, parseInt(seats, 10))
  maxFlights = Math.max(maxFlights, parseInt(flights, 10))

  routeData[routeName] = routeData[routeName] || { origin, destination, originPop, destPop, dist, series: {} }
  const route = routeData[routeName]
  route.series[flyDate] = { passengers, seats, flights }
})

rl.on('close', () => {
  const metadata = {
    totalEntries,
    routesCount: routes.size,
    citiesCount: cities.size,
    timestamps,
    maxPassengers,
    maxSeats,
    maxFlights,
    seriesSchema: `[passengers, seats, flights]`
  }
  const output = { metadata, routeData }
  process.stdout.write(JSON.stringify(output))
})
