// 校对 V2_CALIB 中"平局/predictedScore"类 lesson 文案在 drawInflMax=0.20 后是否仍自洽。跑完即删。
import { getV2, V2_CALIB } from "../lib/prediction-v2.ts"
const keys = Object.keys(V2_CALIB)
console.log("key      pred   1X2(主/平/客)  favClass  real   lesson关键词")
for (const k of ["MEX-RSA", "CAN-BIH", "HAI-SCO", "BRA-MAR", "AUS-TUR", "NED-JPN", "GER-CUW"]) {
  const o = getV2(k)
  console.log(`\n${k}: pred ${o.predictedScore} | 1X2 ${o.homeWin}/${o.draw}/${o.awayWin} | λ ${o.egHome}-${o.egAway} | P屠杀 ${o.blowoutProb}% | O2.5 ${o.over25}%`)
  console.log(`  现 lesson: ${o.lesson ?? "(无)"}`)
}

