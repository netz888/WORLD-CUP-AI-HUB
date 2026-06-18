// Node-only subset of lib/prediction-v2.ts used by background scripts.
// Keep these parameters in sync with the default V6 engine.

export const V6_PARAMS = {
  gdScale: 280,
  baseTotal: 2.9,
  homeAdv: 65,
  rho: -0.12,
  drawInflMax: 0.2,
  drawCloseScale: 200,
  parkBusMax: 0.8,
  parkBusGap: 250,
  blowoutGap: 200,
  blowoutTotalBoost: 1.0,
  blowoutSupBoost: 0.7,
  lambdaFloor: 0.2,
  altWeight: 90,
  kaWeight: 45,
  formWeight: 20,
}

export const ACTIVE_PARAMS = V6_PARAMS

const K_SHRINK = 2.5

function rankToElo(rank) {
  return 2080 - (Math.max(1, rank) - 1) * 6.8
}

export function effectiveRatings(input, P = ACTIVE_PARAMS) {
  let Rh = rankToElo(input.rankHome)
  let Ra = rankToElo(input.rankAway)
  const host = input.host ?? "neutral"

  if (host === "home") Rh += P.homeAdv
  if (host === "away") Ra += P.homeAdv

  const alt = input.alt ?? 0
  if (alt > 1500) {
    const f = Math.min((alt - 1500) / 1500, 1)
    if (host === "home") Ra -= P.altWeight * f
    else if (host === "away") Rh -= P.altWeight * f
    else {
      Rh -= P.altWeight * f * 0.5
      Ra -= P.altWeight * f * 0.5
    }
  }

  Rh -= P.kaWeight * (input.kaHome ?? 0)
  Ra -= P.kaWeight * (input.kaAway ?? 0)
  Rh += P.formWeight * (input.formHome ?? 0)
  Ra += P.formWeight * (input.formAway ?? 0)
  return { Rh, Ra }
}

export function lambdasFromRanks(input, P = ACTIVE_PARAMS) {
  const { Rh, Ra } = effectiveRatings(input, P)
  const diff = Rh - Ra
  let total = P.baseTotal
  let sup = diff / P.gdScale

  const gap = Math.abs(diff)
  if (gap > P.blowoutGap) {
    const over = Math.min((gap - P.blowoutGap) / 300, 1.3)
    total += P.blowoutTotalBoost * over
    sup *= 1 + P.blowoutSupBoost * over
  }

  const lh = Math.max(P.lambdaFloor, total / 2 + sup / 2)
  const la = Math.max(P.lambdaFloor, total / 2 - sup / 2)

  const wH = input.xgHome != null && input.nHome ? input.nHome / (input.nHome + K_SHRINK) : 0
  const wA = input.xgAway != null && input.nAway ? input.nAway / (input.nAway + K_SHRINK) : 0
  const fh = Math.max(P.lambdaFloor, lh * (1 - wH) + (input.xgHome ?? lh) * wH)
  const fa = Math.max(P.lambdaFloor, la * (1 - wA) + (input.xgAway ?? la) * wA)
  return { lh: fh, la: fa, ratingDiff: diff }
}
