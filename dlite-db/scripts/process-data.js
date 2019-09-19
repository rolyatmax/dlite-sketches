const fs = require('fs')
const path = require('path')
const readline = require('readline')
const { dsvFormat } = require('d3-dsv')
const argv = require('minimist')(process.argv.slice(2))

const rl = readline.createInterface({ input: process.stdin })

// FIXME: determine SAMPLE_RATE from the numnber of rows being passed in
// perhaps a hint provided to the CLI?
// const SAMPLE_RATE = 0.01

if (!argv.transform || !argv.outSchema || argv.h || argv.help) {
  console.log()
  console.log('Usage:')
  console.log()
  console.log('  node process-data.js --transform PATH_TO_TRANSFORM_DEFINITIONS --outSchema OUT_SCHEMA_PATH [--delimiter DELIMITER]')
  console.log()
  console.log('    Processes CSV data from stdin using the PATH_TO_TRANSFORM_DEFINITIONS definitions. (The transforms')
  console.log('    definitions file must be a JS file that exports an array. See the source of this script for more')
  console.log('    information.) This script writes binary data to stdout and writes a JSON schema to OUT_SCHEMA_PATH.')
  console.log()
  console.log('  Example: cat my-data.csv | node process-data.js --transform my-data-transform.js --outSchema schema-to-write.json --delimiter="|" > my-data.binary')
  console.log()
  process.exit()
}

const transformPath = path.join(process.cwd(), argv.transform)
const outSchemaPath = path.join(process.cwd(), argv.outSchema)

// FIXME: can't figure out how to pass a tab char on the CLI, so I'm using this :-(
const DELIMITERS = {
  tab: '\t'
}

const delimiter = DELIMITERS[argv.delimiter] || argv.delimiter || ','
const parseRows = dsvFormat(delimiter).parseRows

// load transform-definitions
const transforms = require(transformPath)

// FIXME: how to handle headerless CSVs
// FIXME: how to handle other types of delimiters
let columnNames = null

const outSchema = transforms.map(t => ({
  name: t.name,
  dataType: t.dataType,
  stats: { counts: {} } // stats for all data types have counts
}))

rl.on('line', (input) => {
  if (!columnNames) {
    columnNames = parseRows(input)[0]
    return
  }
  if (!input) return
  const row = createObject(columnNames, parseRows(input)[0])
  const values = transforms.map((t, i) => {
    const value = t.value(row)
    const dataType = getDataType(value)
    if (dataType && outSchema[i].dataType !== dataType) {
      throw new Error(`value returned for ${t.name} is of dataType ${dataType}, not the expected dataType ${outSchema[i].dataType}, given in the transform definition`)
    }
    updateStats(value, i)
    return value
  })
  const floats = convertValuesToFloats(values, outSchema)
  process.stdout.write(Buffer.from(floats.buffer))
})

rl.on('close', () => {
  finishStats(outSchema)
  fs.writeFileSync(outSchemaPath, JSON.stringify(outSchema))
  // let j = 0
  // while (rowValues.length) {
  //   const vals = rowValues.shift()
  //   // console.log(vals)
  //   const floats = convertValuesToFloats(vals, outSchema)
  //   // console.log(floats)
  //   console.log(j++)
  //   const buf = Buffer.from(floats.buffer)

  //   for (let k = 0; k < floats.length; k++) {
  //     const f = new Float32Array([floats[k]])
  //     console.log(f)
  //     process.stdout.write(Buffer.from(f.buffer))
  //   }
  //   // WHY DOES THIS LINE IN PARTICULAR SEEM TO FREEZE THE STDOUT.WRITE?
  //   // process.stdout.write(buf)
  // }
})

function convertValuesToFloats (values, outSchema) {
  const out = []
  for (let i = 0; i < values.length; i++) {
    const value = values[i]
    const column = outSchema[i]
    if (value === null) {
      out.push(Number.MAX_VALUE)
      continue
    }
    if (column.dataType === null) throw new Error(`dataType is null for ${column.name}. Perhaps all values returned were null.`)
    if (column.dataType === 'float') out.push(value)
    if (column.dataType.startsWith('vec')) value.forEach(v => out.push(v))
    if (column.dataType === 'datetime') out.push(value.valueOf() / 1000 | 0)
    if (column.dataType === 'boolean') out.push(value ? 1 : 0)
    if (column.dataType === 'string') out.push(column.valueSet.indexOf(value))
  }
  return new Float32Array(out)
}

function getDataType (val) {
  if (val === null) return null
  if (typeof val === 'boolean') return 'boolean'
  if (typeof val === 'string') return 'string'
  if (Array.isArray(val)) {
    if (val.length > 4 || val.length < 2 || val.some(v => !Number.isFinite(v))) {
      throw new Error(`Array returned must be 2, 3, or 4 number values. Received: ${JSON.stringify(val)}`)
    }
    return `vec${val.length}`
  }
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) throw new Error(`Number returned is not finite. Received: ${JSON.stringify(val)}`)
    return 'float'
  }
  if (val instanceof Date) return 'datetime'
  throw new Error(`Unable to determine data type. Received value: ${JSON.stringify(val)}`)
}

// const samples = []
function updateStats (val, i) {
  const column = outSchema[i]
  if (val === null) return
  const stats = column.stats
  // if this is the first time we're seeing this value for a string, add it to the valueSet
  if (column.dataType === 'string' && !stats.counts[val]) {
    column.valueSet = column.valueSet || []
    column.valueSet.push(val)
  }
  if (column.dataType === 'string' || column.dataType === 'boolean') {
    stats.counts[val] = stats.counts[val] || 0
    stats.counts[val] += 1
  }
  if (['float', 'vec2', 'vec3', 'vec4', 'datetime'].includes(column.dataType)) {
    // samples[i] = samples[i] || []
    // if (Math.random() < SAMPLE_RATE) samples[i].push(val)
    stats.counts.nonnull = stats.counts.nonnull || 0
    stats.counts.nonnull += 1
    stats.counts.sum = add(stats.counts.sum, val)
    stats.extent = stats.extent || []
    stats.extent[0] = min(stats.extent[0], val)
    stats.extent[1] = max(stats.extent[1], val)
  }
}

function finishStats (outSchema) {
  for (const column of outSchema) {
    if (column.dataType === null) throw new Error(`dataType is null for ${column.name}. Perhaps all values returned were null.`)
    if (column.dataType === 'string' || column.dataType === 'boolean') continue
    if (['float', 'vec2', 'vec3', 'vec4', 'datetime'].includes(column.dataType)) {
      const { nonnull, sum } = column.stats.counts
      if (column.dataType === 'float' || column.dataType === 'datetime') {
        column.stats.mean = sum / nonnull
        // TODO - implement column.stats.quantiles here
      } else {
        column.stats.mean = sum.map(v => v / nonnull)
        // TODO - implement column.stats.quantiles here
      }
    }
  }
}

function min (val1, val2) {
  if (val1 == null && val2 == null) throw new Error('Both values passed to min() are null/undefined')
  if (val1 == null) {
    return Array.isArray(val2) ? val2.slice() : val2
  }
  if (val2 == null) {
    return Array.isArray(val1) ? val1.slice() : val1
  }
  if (Array.isArray(val1) !== Array.isArray(val2)) throw new Error('Values passed to min() are not same data type')
  if (Array.isArray(val1) && val1.length !== val2.length) throw new Error('Arrays passed to min() are not same length')
  if (Array.isArray(val1)) {
    return val1.map((v, i) => Math.min(v, val2[i]))
  }
  return Math.min(val1, val2)
}

function max (val1, val2) {
  if (val1 == null && val2 == null) throw new Error('Both values passed to max() are null/undefined')
  if (val1 == null) {
    return Array.isArray(val2) ? val2.slice() : val2
  }
  if (val2 == null) {
    return Array.isArray(val1) ? val1.slice() : val1
  }
  if (Array.isArray(val1) !== Array.isArray(val2)) throw new Error('Values passed to max() are not same data type')
  if (Array.isArray(val1) && val1.length !== val2.length) throw new Error('Arrays passed to max() are not same length')
  if (Array.isArray(val1)) {
    return val1.map((v, i) => Math.max(v, val2[i]))
  }
  return Math.max(val1, val2)
}

function add (val1, val2) {
  if (val1 == null && val2 == null) throw new Error('Both values passed to add() are null/undefined')
  if (val1 == null) {
    return Array.isArray(val2) ? val2.slice() : val2
  }
  if (val2 == null) {
    return Array.isArray(val1) ? val1.slice() : val1
  }
  if (Array.isArray(val1) !== Array.isArray(val2)) throw new Error('Values passed to add() are not same data type')
  if (Array.isArray(val1) && val1.length !== val2.length) throw new Error('Arrays passed to add() are not same length')
  if (Array.isArray(val1)) {
    return val1.map((v, i) => v + val2[i])
  }
  return val1 + val2
}

function createObject (columnNames, values) {
  const obj = {}
  for (let i = 0; i < columnNames.length; i++) {
    obj[columnNames[i]] = values[i]
  }
  return obj
}
