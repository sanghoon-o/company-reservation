const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')

function loadEnv() {
  const envPath = path.resolve(__dirname, '..', '.env')
  if (!fs.existsSync(envPath)) return {}
  const content = fs.readFileSync(envPath, 'utf8')
  const lines = content.split(/\r?\n/)
  const env = {}
  for (const line of lines) {
    const m = line.match(/^\s*([^#][^=\s]*)\s*=\s*(.*)\s*$/)
    if (m) env[m[1]] = m[2]
  }
  return env
}

async function main() {
  const arg = process.argv[2]
  if (!arg) {
    console.error('Usage: node scripts/test-search.js <query>')
    process.exit(1)
  }
  const env = loadEnv()
  const SUPABASE_URL = env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SUPABASE_KEY = env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing Supabase URL/Key in .env or env vars')
    process.exit(2)
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
  const q = arg.replace(/%/g, '')
  const pattern = `${q}%`
  console.log('Searching instruments for prefix:', pattern)
  const { data, error } = await supabase
    .from('instruments')
    .select('*')
    .or(`name.ilike.${pattern},english_name.ilike.${pattern},model.ilike.${pattern}`)
    .limit(100)
  if (error) {
    console.error('Query error:', error)
    process.exit(3)
  }
  console.log('Found', (data||[]).length, 'rows')
  for (const r of data) {
    console.log('-', r.id, r.instrument_no, r.name, r.english_name, r.model)
  }
}

main().catch(err => { console.error(err); process.exit(10) })
