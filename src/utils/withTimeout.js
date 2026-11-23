// Resolve a Supabase call as { error } if it doesn't finish in time, so a
// stuck request can't leave a button on "Saving..." forever.
export function withTimeout(promise, ms = 15000) {
  let timer;
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => resolve({ data: null, error: new Error('Request timed out') }), ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}
