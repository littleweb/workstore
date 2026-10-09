export function buildPlan(args, env) {
  const local = args.includes('--local');
  if (!local && !env.TAURI_SIGNING_PRIVATE_KEY) throw new Error('需要现有更新签名私钥，请勿生成替代密钥');
  return { local, cliArgs: args.filter(arg => arg !== '--local'), publishPreviews: !local, createUpdaterArtifacts: !local };
}
