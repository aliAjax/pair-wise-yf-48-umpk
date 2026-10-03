import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import type { AuthorIdentity, CorrectionRecord, Criterion, JudgeProfile, RankingRow, ReviewEvent, ReviewEventKind, Scheme, ScoreRecord, Viewer } from "../types";

const KEY = "pair-wise-yf-48/review/v2";
const LEGACY_KEY = "pair-wise-yf-48/review";

const judges: Viewer[] = ["评委-林策", "评委-周筑"];

/** 匿名方案库：评委全程可见的只有编号与方案内容 */
const seedSchemes: Scheme[] = [
  { id: "a", code: "S-01", title: "潮间带公共客厅", synopsis: "通过退台屋面把社区活动引向水岸，底层保留可被潮水短暂侵入的公共空间。", publicNo: "投递号 7182", status: "待评分" },
  { id: "b", code: "S-02", title: "风廊共生院", synopsis: "以双庭院组织低能耗社区中心，利用贯穿体量连接既有街巷。", publicNo: "投递号 6610", status: "待评分" },
  { id: "c", code: "S-03", title: "折线工坊", synopsis: "保留旧修理厂桁架，置入可拆装工坊和培训空间。", publicNo: "投递号 8024", status: "待评分" }
];

/** 作者身份库：与匿名方案分离的受限数据集，仅主办方可见 */
const seedAuthorIdentities: AuthorIdentity[] = [
  { schemeId: "a", realName: "陈默", unit: "滨海大学建筑学院" },
  { schemeId: "b", realName: "苏青", unit: "东南大学建筑学院" },
  { schemeId: "c", realName: "黄立", unit: "独立建筑设计事务所" }
];

/** 评委申报单位：系统自动判定回避的依据 */
const seedJudgeProfiles: JudgeProfile[] = [
  { judge: "评委-林策", unit: "滨海大学建筑学院" },
  { judge: "评委-周筑", unit: "东南大学建筑学院" }
];

const criteria: Criterion[] = [
  { id: "site", name: "场地回应", description: "与气候、地貌和周边公共空间的关系", weight: 30, max: 100 },
  { id: "program", name: "功能组织", description: "空间组织、流线和公共性", weight: 25, max: 100 },
  { id: "structure", name: "结构与建造", description: "结构逻辑、材料和建造可行性", weight: 25, max: 100 },
  { id: "sustain", name: "环境策略", description: "节能、碳排和长期维护", weight: 20, max: 100 }
];

function emptyScore(judge: Viewer, schemeId: string): ScoreRecord {
  return { id: `${judge}-${schemeId}`, judge, schemeId, values: Object.fromEntries(criteria.map((item) => [item.id, 60])), comment: "", submitted: false, conflict: false, updatedAt: new Date().toISOString() };
}

interface PersistedState {
  scores: ScoreRecord[];
  events: ReviewEvent[];
  published: boolean;
  schemeStatuses: Record<string, Scheme["status"]>;
  authorIdentities: AuthorIdentity[];
  judgeProfiles: JudgeProfile[];
  corrections: CorrectionRecord[];
  lockedRanking: RankingRow[] | null;
}

function loadState(): PersistedState {
  const fallback: PersistedState = {
    scores: [], events: [], published: false, schemeStatuses: {},
    authorIdentities: seedAuthorIdentities, judgeProfiles: seedJudgeProfiles,
    corrections: [], lockedRanking: null
  };
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY);
    if (!raw) return fallback;
    const saved = JSON.parse(raw);
    return {
      ...fallback,
      ...saved,
      authorIdentities: Array.isArray(saved.authorIdentities) && saved.authorIdentities.length ? saved.authorIdentities : seedAuthorIdentities,
      judgeProfiles: Array.isArray(saved.judgeProfiles) && saved.judgeProfiles.length ? saved.judgeProfiles : seedJudgeProfiles
    };
  } catch {
    return fallback;
  }
}

export const useReviewStore = defineStore("review", () => {
  const initial = loadState();
  const viewer = ref<Viewer>("评委-林策");
  const schemes = ref<Scheme[]>(seedSchemes.map((scheme) => ({ ...scheme, status: initial.schemeStatuses?.[scheme.id] ?? scheme.status })));
  const scores = ref<ScoreRecord[]>(initial.scores);
  const events = ref<ReviewEvent[]>(initial.events);
  const published = ref<boolean>(initial.published);
  const authorIdentities = ref<AuthorIdentity[]>(initial.authorIdentities);
  const judgeProfiles = ref<JudgeProfile[]>(initial.judgeProfiles);
  const corrections = ref<CorrectionRecord[]>(initial.corrections);
  const lockedRanking = ref<RankingRow[] | null>(initial.lockedRanking);

  const isOrganizer = computed(() => viewer.value === "主办方");
  const judge = computed(() => viewer.value.startsWith("评委-") ? viewer.value : null);
  const visibleScores = computed(() => isOrganizer.value ? scores.value : scores.value.filter((score) => score.judge === judge.value));

  /** 作者身份行：评委访问时返回空集，从数据层隔离作者信息 */
  const authorRows = computed<AuthorIdentity[]>(() => isOrganizer.value ? authorIdentities.value : []);
  /** 评委申报单位行：评委只能看到自己的申报单位 */
  const judgeRows = computed<JudgeProfile[]>(() => isOrganizer.value ? judgeProfiles.value : judgeProfiles.value.filter((profile) => profile.judge === judge.value));

  function log(action: string, detail: string, kind: ReviewEventKind = "normal") {
    events.value.unshift({ id: crypto.randomUUID(), time: new Date().toISOString(), actor: viewer.value, action, detail, kind });
  }

  /** 越权访问一律拒绝，并写入审计日志 */
  function deny(action: string, detail: string): false {
    log(`越权拒绝：${action}`, detail, "deny");
    return false;
  }

  /** 受限数据（作者身份、申报库）仅主办方可用 */
  function requireOrganizer(action: string): boolean {
    if (viewer.value !== "主办方") {
      deny(action, `当前身份「${viewer.value}」无权访问该信息，已拒绝并记入审计日志`);
      return false;
    }
    return true;
  }

  /** 系统自动判定回避：评委申报单位与作者申报单位一致即回避。
   *  依赖两套数据集即时重算，任何一方信息变更都会立即生效。 */
  function isRecused(judgeName: Viewer, schemeId: string): boolean {
    const profile = judgeProfiles.value.find((item) => item.judge === judgeName);
    const identity = authorIdentities.value.find((item) => item.schemeId === schemeId);
    if (!profile || !identity) return false;
    const judgeUnit = profile.unit.trim();
    const authorUnit = identity.unit.trim();
    return judgeUnit !== "" && judgeUnit === authorUnit;
  }

  /** 某方案的应评评委（排除系统回避） */
  function expectedJudgesFor(schemeId: string): Viewer[] {
    return judges.filter((name) => !isRecused(name, schemeId));
  }

  /** 有效评分：已提交、未声明利益冲突、未被系统回避。
   *  回避一旦成立，已提交评分即时退出有效评委数，记录保留备查。 */
  function validScoresFor(schemeId: string): ScoreRecord[] {
    return scores.value.filter((score) => score.schemeId === schemeId && score.submitted && !score.conflict && !isRecused(score.judge, schemeId));
  }

  function recusedCountFor(schemeId: string): number {
    return judges.filter((name) => isRecused(name, schemeId)).length;
  }

  /** 评委只能取得自己的评分记录；主办方不能查看或改动任何评分 */
  function record(schemeId: string): ScoreRecord | null {
    const currentJudge = judge.value;
    if (!currentJudge) {
      deny("访问评分", "主办方账号不能查看或改动评委评分，已拒绝");
      return null;
    }
    let item = scores.value.find((score) => score.judge === currentJudge && score.schemeId === schemeId);
    if (!item) {
      item = emptyScore(currentJudge, schemeId);
      scores.value.push(item);
    }
    return item;
  }

  /** 回避期间禁止评分，拒绝并记录 */
  function guardScoring(schemeId: string): boolean {
    const currentJudge = judge.value;
    if (!currentJudge) return false;
    if (isRecused(currentJudge, schemeId)) {
      const code = schemes.value.find((scheme) => scheme.id === schemeId)?.code ?? schemeId;
      deny("回避评分操作", `评委对已系统回避的方案 ${code} 进行评分，已拒绝；该评分不计入有效评委数`);
      return false;
    }
    return true;
  }

  function saveDraft(schemeId: string, values: Record<string, number>, comment: string, conflict: boolean) {
    if (!guardScoring(schemeId)) return;
    const item = record(schemeId);
    if (!item || item.submitted) return;
    item.values = { ...values };
    item.comment = comment;
    item.conflict = conflict;
    item.updatedAt = new Date().toISOString();
    const scheme = schemes.value.find((entry) => entry.id === schemeId);
    if (scheme && scheme.status === "待评分") scheme.status = "评分中";
    log("保存评分草稿", `${scheme?.code ?? schemeId}${conflict ? "，声明利益冲突" : ""}`);
  }

  function submit(schemeId: string, values: Record<string, number>, comment: string, conflict: boolean) {
    if (!guardScoring(schemeId)) return;
    const item = record(schemeId);
    if (!item) return;
    item.values = { ...values };
    item.comment = comment;
    item.conflict = conflict;
    item.submitted = true;
    item.updatedAt = new Date().toISOString();
    const scheme = schemes.value.find((entry) => entry.id === schemeId);
    if (scheme) scheme.status = allSubmittedFor(schemeId) ? "已提交" : "评分中";
    log("提交评分", scheme?.code ?? schemeId);
  }

  function recalled(schemeId: string) {
    if (!guardScoring(schemeId)) return;
    const item = record(schemeId);
    if (!item || published.value) return;
    item.submitted = false;
    log("退回评分修改", schemes.value.find((scheme) => scheme.id === schemeId)?.code ?? schemeId);
  }

  function allSubmittedFor(schemeId: string): boolean {
    const expected = expectedJudgesFor(schemeId);
    return expected.length > 0 && expected.every((name) => scores.value.some((score) => score.judge === name && score.schemeId === schemeId && score.submitted));
  }

  function computeRanking(): RankingRow[] {
    return schemes.value.map((scheme) => {
      const rows = validScoresFor(scheme.id);
      const total = rows.length ? rows.reduce((sum, row) => sum + criteria.reduce((value, criterion) => value + row.values[criterion.id] * criterion.weight / 100, 0), 0) / rows.length : 0;
      return {
        ...scheme,
        total: Number(total.toFixed(2)),
        judgeCount: rows.length,
        conflicts: scores.value.filter((score) => score.schemeId === scheme.id && score.conflict).length,
        recused: recusedCountFor(scheme.id)
      };
    }).sort((a, b) => b.total - a.total);
  }

  /** 锁定后展示冻结快照；锁定前排名不公开，主办方只见提交进度 */
  const ranking = computed<RankingRow[]>(() => lockedRanking.value ?? computeRanking());

  function publish() {
    if (published.value) return;
    if (!schemes.value.every((scheme) => allSubmittedFor(scheme.id))) return;
    published.value = true;
    lockedRanking.value = computeRanking();
    schemes.value.forEach((scheme) => { scheme.status = "已锁定"; });
    log("锁定并发布结果", `${schemes.value.length} 个匿名方案，原排名冻结保留`);
  }

  /** 读取作者身份：评委调用一律拒绝（数据层返回 null） */
  function authorIdentityFor(schemeId: string): AuthorIdentity | null {
    if (!requireOrganizer("读取作者姓名与申报单位")) return null;
    return authorIdentities.value.find((item) => item.schemeId === schemeId) ?? null;
  }

  /** 作者信息变更：锁定前即时生效、回避重算；锁定后只登记待更正记录，原排名保留 */
  function submitAuthorEdit(schemeId: string, patch: { realName?: string; unit?: string }, reason: string) {
    if (!requireOrganizer("修改作者身份信息")) return;
    const identity = authorIdentities.value.find((item) => item.schemeId === schemeId);
    if (!identity) return;
    const scheme = schemes.value.find((item) => item.id === schemeId);
    const label = scheme?.code ?? schemeId;
    const fields: Array<{ key: "realName" | "unit"; type: CorrectionRecord["targetType"]; label: string }> = [
      { key: "realName", type: "作者姓名", label: "作者姓名" },
      { key: "unit", type: "作者单位", label: "申报单位" }
    ];
    if (published.value) {
      fields.forEach((field) => {
        const next = patch[field.key];
        if (next !== undefined && next !== identity[field.key]) {
          corrections.value.unshift({
            id: crypto.randomUUID(), time: new Date().toISOString(),
            targetType: field.type, targetId: schemeId, targetLabel: label,
            field: field.key, oldValue: identity[field.key], newValue: next,
            reason: reason || "锁定后更正登记", status: "待更正"
          });
        }
      });
      log("登记待更正记录", `${label}：锁定后变更仅登记，原排名保留`);
      return;
    }
    const changes = fields
      .filter((field) => patch[field.key] !== undefined && patch[field.key] !== identity[field.key])
      .map((field) => `${field.label} ${identity[field.key]} → ${patch[field.key]}`);
    Object.assign(identity, patch);
    log("更新作者身份信息", `${label}：${changes.join("；")}。回避判定已即时重算，受影响评分退出有效评委数`);
  }

  /** 评委申报单位变更：同上 */
  function submitJudgeUnitEdit(judgeName: Viewer, unit: string, reason: string) {
    if (!requireOrganizer("修改评委申报单位")) return;
    const profile = judgeProfiles.value.find((item) => item.judge === judgeName);
    if (!profile) return;
    if (published.value) {
      if (unit !== profile.unit) {
        corrections.value.unshift({
          id: crypto.randomUUID(), time: new Date().toISOString(),
          targetType: "评委单位", targetId: judgeName, targetLabel: judgeName,
          field: "unit", oldValue: profile.unit, newValue: unit,
          reason: reason || "锁定后更正登记", status: "待更正"
        });
      }
      log("登记待更正记录", `${judgeName}：锁定后变更仅登记，原排名保留`);
      return;
    }
    const old = profile.unit;
    profile.unit = unit;
    log("更新评委申报单位", `${judgeName}：${old} → ${unit}。回避判定已即时重算，受影响评分退出有效评委数`);
  }

  function setViewer(value: Viewer) { viewer.value = value; }

  watch([scores, events, published, schemes, authorIdentities, judgeProfiles, corrections, lockedRanking], () => {
    localStorage.setItem(KEY, JSON.stringify({
      scores: scores.value,
      events: events.value,
      published: published.value,
      schemeStatuses: Object.fromEntries(schemes.value.map((scheme) => [scheme.id, scheme.status])),
      authorIdentities: authorIdentities.value,
      judgeProfiles: judgeProfiles.value,
      corrections: corrections.value,
      lockedRanking: lockedRanking.value
    }));
  }, { deep: true });

  return {
    viewer, schemes, criteria, judges, scores, events, published, corrections,
    authorRows, judgeRows, isOrganizer, judge, visibleScores, ranking,
    setViewer, record, saveDraft, submit, recalled, publish,
    allSubmittedFor, expectedJudgesFor, validScoresFor, recusedCountFor, isRecused,
    authorIdentityFor, submitAuthorEdit, submitJudgeUnitEdit, requireOrganizer
  };
});
