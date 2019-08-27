// expects a comma-separated csv from stdin with the following columns:
// AirportID,Name,City,Country,IATA,ICAO,Latitude,Longitude,Altitude,TimezoneOffset,DST,TzDatabaseTimezone,Type,Source
// 1,"Goroka Airport","Goroka","Papua New Guinea","GKA","AYGA",-6.081689834590001,145.391998291,5282,10,"U","Pacific/Port_Moresby","airport","OurAirports"

const readline = require('readline')
const { csvParseRows } = require('d3-dsv')

const rl = readline.createInterface({ input: process.stdin })

let firstLine = true

const airports = {}

rl.on('line', (input) => {
  if (!input || firstLine) {
    firstLine = false
    return
  }
  const [airportID, name, city, country, iata, icao, latitude, longitude, altitude] = csvParseRows(input)[0]
  airports[iata] = {
    iata: iata,
    name: name,
    city: `${city}, ${country}`,
    latitude: parseFloat(latitude),
    longitude: parseFloat(longitude),
    altitude: parseFloat(altitude)
  }
})

rl.on('close', () => {
  process.stdout.write(JSON.stringify(airports))
})
