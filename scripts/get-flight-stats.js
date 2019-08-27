// expects a tab-separated tsv from stdin with the following columns:
// Origin	Destination	OriginCity	DestinationCity	Passengers	Seats	Flights	Distance	FlyDate	OriginPopulation	DestinationPopulation

const readline = require('readline')

const rl = readline.createInterface({ input: process.stdin })

const timestamps = [null, null]
const passengerCounts = [Infinity, -Infinity]
const seatCounts = [Infinity, -Infinity]
const flightCounts = [Infinity, -Infinity]

const routes = new Set()
const cities = new Set()
let totalEntries = 0

let firstLine = true

rl.on('line', (input) => {
  if (!input || firstLine) {
    firstLine = false
    return
  }
  totalEntries += 1
  const [origin, destination, originCity, destCity, passengers, seats, flights, dist, flyDate, originPop, destPop] = input.split(`	`)
  cities.add(origin)
  cities.add(destination)
  routes.add(`${origin}-${destination}`)
  timestamps[0] = timestamps[0] && timestamps[0] < flyDate ? timestamps[0] : flyDate
  timestamps[1] = timestamps[1] && timestamps[1] > flyDate ? timestamps[1] : flyDate
  passengerCounts[0] = Math.min(passengerCounts[0], parseInt(passengers, 10))
  passengerCounts[1] = Math.max(passengerCounts[1], parseInt(passengers, 10))
  seatCounts[0] = Math.min(seatCounts[0], parseInt(seats, 10))
  seatCounts[1] = Math.max(seatCounts[1], parseInt(seats, 10))
  flightCounts[0] = Math.min(flightCounts[0], parseInt(flights, 10))
  flightCounts[1] = Math.max(flightCounts[1], parseInt(flights, 10))
})

rl.on('close', () => {
  console.log({
    totalEntries,
    routes: routes.size,
    cities: cities.size,
    timestamps,
    passengerCounts,
    seatCounts,
    flightCounts
  })
})
