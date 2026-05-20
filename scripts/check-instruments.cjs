const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')

const envPath = path.resolve(__dirname, '..', '.env')
const env = fs.existsSync(envPath)
  ? Object.fromEntries(
      fs.readFileSync(envPath, 'utf8')
        .split(/\r?\n/)
        .map(line => {
          const m = line.match(/^([^=]+)=(.*)$/)
          return m ? [m[1], m[2]] : null
        })
        .filter(Boolean)
    )
  : {}

const SUPABASE_URL = env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_KEY = env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing Supabase URL/Key in .env or env vars')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

async function main() {
  const count = await supabase.from('instruments').select('id', { count: 'exact', head: true })
  console.log('count error', count.error)
  console.log('count', count.count)

  const sample = await supabase.from('instruments').select('instrument_no,name,english_name,model').limit(10)
  console.log('sample error', sample.error)
  console.log('sample data', sample.data)
}

main().catch(err => {
  console.error('unexpected error', err)
  process.exit(1)
})
