/** Safe, bilingual presentation of observed failures. Never display arbitrary upstream text. */
export function paymentFailure(error: unknown): {key: string; vars: Record<string, string | number>} {
  const fallback = {key:'pay.error.unknown', vars:{}};
  if (!(error instanceof Error) || error.name !== 'QoreChainReadError' || !('code' in error)) return fallback;
  const details = 'details' in error && typeof error.details === 'object' && error.details !== null
    ? error.details as Record<string, unknown> : {};
  if (error.code === 'network_error') {
    const code = String(details.transportCode);
    const kind = ['ENOTFOUND','EAI_AGAIN'].includes(code) ? 'dns'
      : ['EACCES','EPERM'].includes(code) ? 'connection_denied'
      : ['CERT_HAS_EXPIRED','CERT_NOT_YET_VALID','DEPTH_ZERO_SELF_SIGNED_CERT',
        'UNABLE_TO_VERIFY_LEAF_SIGNATURE','SELF_SIGNED_CERT_IN_CHAIN','ERR_TLS_CERT_ALTNAME_INVALID',
        'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(code) ? 'tls' : 'network_unknown';
    return {key:'pay.error.' + kind, vars:{}};
  }
  if (error.code === 'http_error' && Number.isInteger(details.httpStatus) && Number(details.httpStatus) >= 100 && Number(details.httpStatus) <= 599) {
    return {key:'pay.error.http', vars:{status:Number(details.httpStatus)}};
  }
  if (error.code === 'rpc_error' && Number.isSafeInteger(details.rpcCode)) {
    return {key:'pay.error.rpc', vars:{code:Number(details.rpcCode)}};
  }
  if (['timeout','chain_mismatch','invalid_response','history_unavailable','evidence_mismatch'].includes(String(error.code))) {
    return {key:'pay.error.' + error.code, vars:{}};
  }
  return fallback;
}
