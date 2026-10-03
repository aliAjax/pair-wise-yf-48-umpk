import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import type {
  CorrectionRequest,
  Criterion,
  Judge,
  MaskedIdentity,
  RankRow,
  ReviewEvent,
  Scheme,
  SchemeIdentity,
  ScoreRecord,
  ViewerId,
} from "../types";

const KEY = "pair-wise-yf-48/review/v2";

/** 公开侧：评委可见的只有匿名编号和方案内容 */
const seedSchemes: Scheme[] = [
  { id: "a", code: "AN-01", title: "潮间带公共客厅", synopsis: "通过退台屋面把社区活动引向水岸，底层保留可被潮水短暂侵入的公共空间。", publicNo: "投递号 7182" },
  { id: "b", code: "AN-02", title: "风廊共生院", synopsis: "以双庭院组织低能耗社区中心，利用贯穿体量连接既有街巷。", publicNo: "投递号 6610" },
  { id: "c", code: "AN-03", title: "折线工坊", synopsis: "保留旧修理厂桁架，置入可拆装工坊和培训空间。", publicNo: "投递号 8024" }
];

/** 敏感侧：作者姓名与申报单位，独立成库，不进入评委的任何读路径 */
const seedIdentities: SchemeIdentity[] = [
  { schemeId: "a", authors: ["沈屿"], organization: "东海岸建筑设计院", version: 1 },
  { schemeId: "b", authors: ["柯望", "林策"], organization: "合垣建筑事务所", version: 1 },
  { schemeId: "c", authors: ["周筑"], organization: "城北工业遗产研究中心", version: 1 }
];

const seedJudges: Judge[] = [
  { id: "j1", name: "林策", organization: "合垣建筑事务所" },
  { id: "j2", name: "周筑", organization: "筑原设计研究院" },
  { id: "j3", name: "秦砚", organization: "东海岸建筑设计院" }
];

const criteria: Criterion[] = [
  { id: "site", name: "场地回应", description: "与气候、地貌和周边公共空间的关系", weight: 30, max: 100 },
  { id: "program", name: "功能组织", description: "空间组织、流线和公共性", weight: 25, max: 100 },
  { id: "structure", name: "结构与建造", description: "结构逻辑、材料和建造可行性", weight: 25, max: 100 },
  { id: "sustain", name: "环境策略", description: "节能、碳排和长期维护", weight: 20, max: 100 }
];

interface PersistShape {
  identities: SchemeIdentity[];
  judges: Judge[];
  scores: ScoreRecord[];
  events: ReviewEvent[];
  locked: boolean;
  lockedAt: string | null;
  rankingSnapshot: RankRow[] | null;
  corrections: CorrectionRequest[];
}

function load(): Partial<PersistShape> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PersistShape) : {};
  } catch {
    return {};
  }
}

function weightedTotal(values: Record<string, number>) {
  return criteria.reduce((sum, item) => sum + (values[item.id] ?? 0) * (item.weight / 100), 0);
}

export class AccessDeniedError extends Error {}

function defaultValues(): Record<string, number> {
  return Object.fromEntries(criteria.map((item) => [item.id, 60]));
}

export const useReviewStore = defineStore("review", () => {
  const saved = load();

  const viewerId = ref<ViewerId>("j1");
  const schemes = ref<Scheme[]>(seedSchemes.map((item) => ({ ...item })));
  const identities = ref<SchemeIdentity[]>(
    seedIdentities.map((item) => ({ ...item, authors: [...item.authors] }))
  );
  const judges = ref<Judge[]>(saved.judges?.length ? saved.judges : seedJudges.map((item) => ({ ...item })));
  const scores = ref<ScoreRecord[]>(saved.scores ?? []);
  const events = ref<ReviewEvent[]>(saved.events ?? []);
  const locked = ref<boolean>(saved.locked ?? false);
  const lockedAt = ref<string | null>(saved.lockedAt ?? null);
  const rankingSnapshot = ref<RankRow[] | null>(saved.rankingSnapshot ?? null);
  const corrections = ref<CorrectionRequest[]>(saved.corrections ?? []);

  const isOrganizer = computed(() => viewerId.value === "org");
  const currentJudge = computed(() => judges.value.find((item) => item.id === viewerId.value) ?? null);
  const viewerName = computed(() => (isOrganizer.value ? "主办方" : currentJudge.value?.name ?? "未知身份"));

  function log(action: string, detail: string, level: ReviewEvent["level"] = "info") {
    events.value.unshift({ id: crypto.randomUUID(), time: new Date().toISOString(), actor: viewerName.value, action, detail, level });
  }

  /* ------------------------------------------------------------------ */
  /* 回避判定：只比对单位/作者，不向调用方泄露任何身份字段                 */
  /* ------------------------------------------------------------------ */

  /** 命中回避的 (judgeId, schemeId) 集合；身份信息一变即整体重算 */
  const recusalSet = computed(() => {
    const set = new Set<string>();
    for (const judge of judges.value) {
      for (const identity of identities.value) {
        const sameOrg = !!identity.organization && identity.organization === judge.organization;
        const isAuthor = identity.authors.includes(judge.name);
        if (sameOrg || isAuthor) set.add(`${judge.id}:${identity.schemeId}`);
      }
    }
    return set;
  });

  function isRecused(judgeId: string, schemeId: string) {
    return recusalSet.value.has(`${judgeId}:${schemeId}`);
  }

  /** 当前评委在当前数据版本下需要回避的方案 */
  const myRecusals = computed(() => {
    if (!currentJudge.value) return new Set<string>();
    return new Set(
      schemes.value.filter((scheme) => isRecused(currentJudge.value!.id, scheme.id)).map((scheme) => scheme.id)
    );
  });

  /**
   * 评分提交时固化回避判定版本：记录提交时刻命中的规则与身份版本号。
   * 身份数据后续一旦改动，旧版本判定立即失效，该评分退出有效评委数。
   */
  const recusalVersion = computed(() => {
    const orgParts = identities.value
      .map((item) => `${item.schemeId}=${item.organization}|${item.authors.join("/")}@v${item.version}`)
      .sort()
      .join(";");
    const judgeParts = judges.value
      .map((item) => `${item.id}=${item.name}@${item.organization}`)
      .sort()
      .join(";");
    return `${orgParts}#${judgeParts}`;
  });

  /* ------------------------------------------------------------------ */
  /* 身份库访问控制：评委读取作者姓名一律拒绝                              */
  /* ------------------------------------------------------------------ */

  /** 主办方读完整身份；评委读取即拒绝（自动回避走 isRecused，不需要看身份） */
  function getIdentity(schemeId: string): SchemeIdentity {
    if (!isOrganizer.value) {
      log("越权读取被拒绝", `${viewerName.value} 请求读取方案 ${schemeCode(schemeId)} 的作者/单位信息`, "denied");
      throw new AccessDeniedError("评委无权读取作者姓名或申报单位");
    }
    const found = identities.value.find((item) => item.schemeId === schemeId);
    if (!found) throw new AccessDeniedError("身份记录不存在");
    return found;
  }

  /** 评委侧唯一允许的身份视图：全部脱敏，仅用于演示"看不到" */
  function maskedIdentity(schemeId: string): MaskedIdentity {
    return { schemeId, authors: ["***"], organization: "***", version: identities.value.find((i) => i.schemeId === schemeId)?.version ?? 0, masked: true };
  }

  /* ------------------------------------------------------------------ */
  /* 评分读写：只允许本人操作本人的评分                                   */
  /* ------------------------------------------------------------------ */

  function ownScore(schemeId: string, judgeId: string = viewerId.value): ScoreRecord | undefined {
    return scores.value.find((score) => score.judgeId === judgeId && score.schemeId === schemeId);
  }

  function ensureScore(schemeId: string): ScoreRecord {
    if (isOrganizer.value || !currentJudge.value) {
      log("越权评分被拒绝", `${viewerName.value} 试图对 ${schemeCode(schemeId)} 建立评分`, "denied");
      throw new AccessDeniedError("主办方不能评分");
    }
    if (isRecused(currentJudge.value.id, schemeId)) {
      log("回避方案访问被拒绝", `${viewerName.value} 试图打开应回避方案 ${schemeCode(schemeId)}`, "denied");
      throw new AccessDeniedError("系统判定您与该方案存在利益关联，已自动回避");
    }
    let item = ownScore(schemeId);
    if (!item) {
      item = {
        id: crypto.randomUUID(),
        judgeId: currentJudge.value.id,
        schemeId,
        values: defaultValues(),
        comment: "",
        submitted: false,
        selfConflict: false,
        updatedAt: new Date().toISOString()
      };
      scores.value.push(item);
    }
    return item;
  }

  /** 越权防护：评委 A 不得改动评委 B 的评分 */
  function guardOwn(record: ScoreRecord | undefined, action: string) {
    if (isOrganizer.value) {
      log(`越权${action}被拒绝`, `主办方试图${action}评委评分`, "denied");
      throw new AccessDeniedError(`主办方无权${action}评委评分`);
    }
    if (!record || record.judgeId !== viewerId.value) {
      log(`越权${action}被拒绝`, `${viewerName.value} 试图${action}他人的评分`, "denied");
      throw new AccessDeniedError(`只能${action}本人的评分`);
    }
  }

  function saveDraft(schemeId: string, values: Record<string, number>, comment: string, selfConflict: boolean) {
    if (locked.value) throw new AccessDeniedError("结果已锁定，评分不可修改");
    const item = ensureScore(schemeId);
    item.values = { ...values };
    item.comment = comment;
    item.selfConflict = selfConflict;
    item.updatedAt = new Date().toISOString();
    log("保存评分草稿", `${schemeCode(schemeId)}${selfConflict ? "，评委自行声明利益冲突" : ""}`);
  }

  function submit(schemeId: string, values: Record<string, number>, comment: string, selfConflict: boolean) {
    if (locked.value) throw new AccessDeniedError("结果已锁定，评分不可修改");
    const item = ensureScore(schemeId);
    item.values = { ...values };
    item.comment = comment;
    item.selfConflict = selfConflict;
    item.submitted = true;
    item.updatedAt = new Date().toISOString();
    log("提交评分", `${schemeCode(schemeId)}（按当前身份版本判定：${isRecused(item.judgeId, schemeId) ? "回避" : "有效"}）`);
  }

  function recall(schemeId: string) {
    if (locked.value) throw new AccessDeniedError("结果已锁定，评分不可退回");
    const item = ownScore(schemeId);
    guardOwn(item, "退回");
    if (!item!.submitted) return;
    item!.submitted = false;
    item!.updatedAt = new Date().toISOString();
    log("退回评分修改", schemeCode(schemeId));
  }

  /* ------------------------------------------------------------------ */
  /* 有效性：提交后若身份/单位变更导致回避重算，受影响评分退出有效评委数   */
  /* ------------------------------------------------------------------ */

  /** 已提交评分在"当前"回避判定下是否仍然有效 */
  function isScoreActive(score: ScoreRecord) {
    return score.submitted && !score.selfConflict && !isRecused(score.judgeId, score.schemeId);
  }

  /** 因身份版本变化而新近失效（已提交、未自行冲突、现在命中回避）的评分 */
  const invalidatedScores = computed(() =>
    scores.value.filter((score) => score.submitted && !score.selfConflict && isRecused(score.judgeId, score.schemeId))
  );

  function activeScoresFor(schemeId: string) {
    return scores.value.filter((score) => score.schemeId === schemeId && isScoreActive(score));
  }

  function submittedCount(schemeId: string) {
    return scores.value.filter((score) => score.schemeId === schemeId && score.submitted).length;
  }

  /** 评委本人是否可提交该方案：未命中自动回避 */
  function judgeCanReview(judgeId: string, schemeId: string) {
    return !isRecused(judgeId, schemeId);
  }

  function schemeCode(schemeId: string) {
    return schemes.value.find((scheme) => scheme.id === schemeId)?.code ?? schemeId;
  }

  function judgeName(id: string) {
    return judges.value.find((judge) => judge.id === id)?.name ?? id;
  }

  /* ------------------------------------------------------------------ */
  /* 主办方维护身份库 / 评委申报单位：改动即版本递增、回避立即失效重算     */
  /* ------------------------------------------------------------------ */

  function updateIdentity(schemeId: string, patch: { authors: string[]; organization: string }) {
    if (!isOrganizer.value) {
      log("越权改动被拒绝", `${viewerName.value} 试图修改作者/单位信息`, "denied");
      throw new AccessDeniedError("只有主办方可以维护作者身份信息");
    }
    const target = identities.value.find((item) => item.schemeId === schemeId);
    if (!target) return;
    const authorsChanged = target.authors.join("/") !== patch.authors.join("/");
    const orgChanged = target.organization !== patch.organization;
    if (!authorsChanged && !orgChanged) return;
    // 锁定后：身份库冻结，任何更正只登记待更正记录，原排名保留
    if (locked.value) {
      registerCorrection(
        "作者/单位信息更正",
        `${schemeCode(schemeId)} 申请将作者/单位改为：${patch.authors.join("、")} / ${patch.organization}（当前 v${target.version}）`,
        schemeCode(schemeId)
      );
      return;
    }
    target.authors = [...patch.authors];
    target.organization = patch.organization;
    target.version += 1;

    // recusalSet 是 computed，依赖 identities/judges，此处读取即基于新版本重算
    const affected = scores.value.filter(
      (score) => score.schemeId === schemeId && score.submitted && isRecused(score.judgeId, schemeId)
    );
    log(
      "作者/单位信息变更",
      `${schemeCode(schemeId)} 身份库升至 v${target.version}；回避判定立即重算，${affected.length} 份已提交评分退出有效评委数`,
      "system"
    );
    affected.forEach((score) => {
      log("回避重算·评分失效", `${judgeName(score.judgeId)} 对 ${schemeCode(schemeId)} 的已提交评分不再计入`, "system");
    });
  }

  function updateJudgeOrg(judgeId: string, organization: string) {
    if (!isOrganizer.value) {
      log("越权改动被拒绝", `${viewerName.value} 试图修改评委申报单位`, "denied");
      throw new AccessDeniedError("只有主办方可以维护评委申报单位");
    }
    const target = judges.value.find((item) => item.id === judgeId);
    if (!target || target.organization === organization) return;
    const old = target.organization;
    if (locked.value) {
      registerCorrection("评委申报单位更正", `${target.name} 申请将申报单位由「${old}」改为「${organization}」`);
      return;
    }
    target.organization = organization;
    const affected = scores.value.filter((score) => score.judgeId === judgeId && score.submitted && isRecused(judgeId, score.schemeId));
    log(
      "评委申报单位变更",
      `${target.name}：${old} → ${organization}；回避判定立即重算，${affected.length} 份已提交评分退出有效评委数`,
      "system"
    );
    affected.forEach((score) => {
      log("回避重算·评分失效", `${target.name} 对 ${schemeCode(score.schemeId)} 的已提交评分不再计入`, "system");
    });
  }

  /* ------------------------------------------------------------------ */
  /* 锁定：锁定前主办方只看进度；锁定后排名固化，更正只登记               */
  /* ------------------------------------------------------------------ */

  /** 每个方案"应当参评"的评委 = 全体评委 - 当前回避者；全部提交才可锁定 */
  const canLock = computed(() =>
    schemes.value.every((scheme) => {
      const required = judges.value.filter((judge) => judgeCanReview(judge.id, scheme.id));
      const done = required.every((judge) => {
        const score = ownScore(scheme.id, judge.id);
        return score?.submitted && !score.selfConflict;
      });
      return required.length > 0 && done;
    })
  );

  function buildRanking(): RankRow[] {
    return schemes.value
      .map((scheme) => {
        const rows = activeScoresFor(scheme.id);
        const total = rows.length
          ? rows.reduce((sum, row) => sum + weightedTotal(row.values), 0) / rows.length
          : 0;
        return {
          schemeId: scheme.id,
          code: scheme.code,
          title: scheme.title,
          total: Number(total.toFixed(2)),
          judgeCount: rows.length,
          selfConflicts: scores.value.filter((s) => s.schemeId === scheme.id && s.submitted && s.selfConflict).length,
          recused: judges.value.filter((judge) => isRecused(judge.id, scheme.id)).length
        };
      })
      .sort((a, b) => b.total - a.total || a.code.localeCompare(b.code));
  }

  function lockResults() {
    if (locked.value) return;
    if (!canLock.value) {
      log("锁定被拒绝", "仍有应参评评委未提交有效评分", "denied");
      throw new AccessDeniedError("仍有评委未完成提交，不能锁定");
    }
    rankingSnapshot.value = buildRanking();
    locked.value = true;
    lockedAt.value = new Date().toISOString();
    log("锁定并发布结果", `共 ${schemes.value.length} 个匿名方案，排名已固化`, "system");
  }

  /** 锁定后的任何更正：只登记待更正记录，锁定快照与原排名一律保留 */
  function registerCorrection(type: CorrectionRequest["type"], detail: string, schemeCodeValue?: string) {
    if (!locked.value) {
      log("更正登记被拒绝", "结果尚未锁定，无需登记更正，请直接调整", "denied");
      throw new AccessDeniedError("未锁定前可直接修改，不需要登记更正");
    }
    const item: CorrectionRequest = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      requester: viewerName.value,
      type,
      schemeCode: schemeCodeValue,
      detail
    };
    corrections.value.unshift(item);
    log("登记待更正记录", `【${type}】${detail}；原排名保留，待复核后处理`, "system");
    return item;
  }

  function setViewer(value: ViewerId) {
    viewerId.value = value;
  }

  watch(
    [identities, judges, scores, events, locked, lockedAt, rankingSnapshot, corrections],
    () => {
      const payload: PersistShape = {
        identities: identities.value,
        judges: judges.value,
        scores: scores.value,
        events: events.value,
        locked: locked.value,
        lockedAt: lockedAt.value,
        rankingSnapshot: rankingSnapshot.value,
        corrections: corrections.value
      };
      localStorage.setItem(KEY, JSON.stringify(payload));
    },
    { deep: true }
  );

  return {
    // state
    viewerId,
    schemes,
    identities,
    judges,
    criteria,
    scores,
    events,
    locked,
    lockedAt,
    corrections,
    // getters
    isOrganizer,
    currentJudge,
    viewerName,
    myRecusals,
    invalidatedScores,
    canLock,
    recusalVersion,
    ranking: computed(() => rankingSnapshot.value ?? []),
    // helpers
    isRecused,
    isScoreActive,
    activeScoresFor,
    submittedCount,
    judgeCanReview,
    ownScore,
    ensureScore,
    judgeName,
    getIdentity,
    maskedIdentity,
    // actions
    setViewer,
    saveDraft,
    submit,
    recall,
    updateIdentity,
    updateJudgeOrg,
    lockResults,
    registerCorrection
  };
});
