export function logEnvironmentStatus(): void {
  console.log('Environment Status:');
  console.log('- Supabase URL:', import.meta.env.VITE_SUPABASE_URL ? '✓' : '✗');
  console.log('- Supabase Key:', import.meta.env.VITE_SUPABASE_ANON_KEY ? '✓' : '✗');
  console.log('- MetaAPI Account:', import.meta.env.VITE_METAAPI_ACCOUNT_ID ? '✓' : '✗');
  console.log('- MetaAPI Region:', import.meta.env.VITE_METAAPI_REGION ? '✓' : '✗');
  console.log('- OpenAI Key:', import.meta.env.VITE_OPENAI_API_KEY ? '✓' : '✗');
}
