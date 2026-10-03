export type Viewer = "评委-林策" | "评委-周筑" | "主办方";
export type SchemeStatus = "待评分" | "评分中" | "已提交" | "已锁定";

/** 匿名方案：评委可见的唯一数据集（匿名编号 + 方案内容） */
export interface Scheme {
  id: string;
  code: string;
  title: string;
  synopsis: string;
  publicNo: string;
  status: SchemeStatus;
}

/** 作者身份信息：与匿名方案分离的受限数据集，仅主办方可见 */
export interface AuthorIdentity {
  schemeId: string;
  realName: string;
  unit: string;
}

/** 评委申报信息：系统自动判定回避的依据 */
export interface JudgeProfile {
  judge: Viewer;
  unit: string;
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
  judge: Viewer;
  schemeId: string;
  values: Record<string, number>;
  comment: string;
  submitted: boolean;
  conflict: boolean;
  updatedAt: string;
}

/** 待更正记录：结果锁定后登记，不改变已锁定排名 */
export interface CorrectionRecord {
  id: string;
  time: string;
  targetType: "作者单位" | "作者姓名" | "评委单位";
  targetId: string;
  targetLabel: string;
  field: string;
  oldValue: string;
  newValue: string;
  reason: string;
  status: "待更正";
}

export type ReviewEventKind = "normal" | "deny";

export interface ReviewEvent {
  id: string;
  time: string;
  actor: Viewer;
  action: string;
  detail: string;
  kind: ReviewEventKind;
}

/** 排名行：仅统计有效评分（已提交、未声明冲突、未被系统回避） */
export interface RankingRow extends Scheme {
  total: number;
  judgeCount: number;
  conflicts: number;
  recused: number;
}
