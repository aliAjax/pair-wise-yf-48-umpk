export type ViewerId = "j1" | "j2" | "j3" | "org";
export type SchemeStatus = "待评分" | "评分中" | "已提交" | "已锁定";

/** 评委档案：姓名与评委自己的申报单位（回避判定用） */
export interface Judge {
  id: string;
  name: string;
  organization: string;
}

/**
 * 公开侧方案数据：只含匿名编号与方案内容。
 * 严禁出现作者姓名或申报单位——身份信息在 SchemeIdentity 中单独存放。
 */
export interface Scheme {
  id: string;
  code: string;
  title: string;
  synopsis: string;
  publicNo: string;
}

/** 敏感侧身份数据：与匿名编号分开保管，仅主办方可读，改动即产生新版本 */
export interface SchemeIdentity {
  schemeId: string;
  authors: string[];
  organization: string;
  version: number;
}

export interface Criterion {
  id: string;
  name: string;
  description: string;
  weight: number;
  max: number;
}

export interface ScoreRecord {
  id: string;
  judgeId: string;
  schemeId: string;
  values: Record<string, number>;
  comment: string;
  submitted: boolean;
  /** 评委主动声明的利益冲突（区别于系统按单位/作者自动判定的回避） */
  selfConflict: boolean;
  updatedAt: string;
}

export type CorrectionType = "成绩更正" | "作者/单位信息更正" | "评委申报单位更正";

/** 锁定后的更正只能登记，不改动锁定时的排名快照 */
export interface CorrectionRequest {
  id: string;
  createdAt: string;
  requester: string;
  type: CorrectionType;
  schemeCode?: string;
  detail: string;
}

export interface RankRow {
  schemeId: string;
  code: string;
  title: string;
  total: number;
  judgeCount: number;
  selfConflicts: number;
  recused: number;
}

export interface ReviewEvent {
  id: string;
  time: string;
  actor: string;
  action: string;
  detail: string;
  level: "info" | "denied" | "system";
}

/** 评委读取身份库时拿到的脱敏 DTO */
export interface MaskedIdentity {
  schemeId: string;
  authors: string[];
  organization: string;
  version: number;
  masked: boolean;
}
