import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://nzisgxdlydihlwsvonfy.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im56aXNneGRseWRpaGx3c3ZvbmZ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1OTU5NTU0MCwiZXhwIjoyMDc1MTcxNTQwfQ.Bas3dKkvMSzBPAK4zUJ24JC-T0-bcLQeJ458KYv-X5U'
);

async function getSchema() {
  // Get one record to see columns
  const { data, error } = await supabase
    .from('goal_session_trades')
    .select('*')
    .limit(1);

  if (error) {
    console.error('Error:', error.message);
    return;
  }

  if (data && data.length > 0) {
    console.log('goal_session_trades columns:');
    console.log(Object.keys(data[0]).join(', '));
    console.log('\nSample record:');
    console.log(JSON.stringify(data[0], null, 2));
  } else {
    console.log('No data in goal_session_trades');
  }
}

getSchema().catch(console.error);
