import { supabase } from '../supabaseClient';

const BUCKET = 'payment-proofs';
const SIGNED_URL_TTL_SECONDS = 60 * 60;

function getObjectPath(reference) {
  if (!reference) return null;

  try {
    const url = new URL(reference);
    const marker = `/object/public/${BUCKET}/`;
    const signedMarker = `/object/sign/${BUCKET}/`;
    const markerIndex = Math.max(
      url.pathname.indexOf(marker),
      url.pathname.indexOf(signedMarker),
    );
    if (markerIndex >= 0) {
      const markerLength = url.pathname.includes(marker, markerIndex) ? marker.length : signedMarker.length;
      return decodeURIComponent(url.pathname.slice(markerIndex + markerLength));
    }
  } catch {
    return reference;
  }

  return reference;
}

export async function uploadPaymentProof(file, userId, context, recordId) {
  const extension = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${userId}/${context}/${recordId}/${Date.now()}-${crypto.randomUUID()}.${extension || 'jpg'}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file);
  if (error) throw new Error(error.message);
  return path;
}

export async function resolvePaymentProofUrl(reference) {
  const path = getObjectPath(reference);
  if (!path) return null;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error) throw new Error(`Unable to access payment proof: ${error.message}`);
  return data.signedUrl;
}

// One image that can't be signed (deleted by the rejected-proof cleanup, or not
// readable by this account) must not break the whole list: that row just gets no
// screenshot (image_missing: true) and the others still load.
export async function resolvePaymentProofUrls(rows) {
  return Promise.all((rows || []).map(async row => {
    if (!row.screenshot_url) return row;
    try {
      return { ...row, screenshot_url: await resolvePaymentProofUrl(row.screenshot_url) };
    } catch (err) {
      console.warn('[proofs] screenshot unavailable for', row.id, err.message);
      return { ...row, screenshot_url: null, image_missing: true };
    }
  }));
}

// Rejected proofs keep their screenshot this long; after that the scheduled
// cleanup-rejected-proofs function deletes only the file and sets
// image_deleted_at. Keep in sync with RETENTION_DAYS in that function.
export const PROOF_IMAGE_RETENTION_DAYS = 60;

/** Member hides/unhides one of their own rejected entries in Payment History.
 *  kind: 'main' | 'followup' | 'refund' */
export async function setRejectedProofHidden(kind, id, hidden = true) {
  const { error } = await supabase.rpc('set_rejected_proof_hidden', { p_kind: kind, p_id: id, p_hidden: hidden });
  if (error) throw new Error(error.message);
}
