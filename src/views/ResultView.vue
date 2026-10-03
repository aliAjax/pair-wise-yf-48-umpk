<script setup lang="ts">
import { computed, reactive } from "vue";
import {
  NAlert, NButton, NCard, NEmpty, NInput, NTable, NTag, NTime, useMessage
} from "naive-ui";
import { useReviewStore, AccessDeniedError } from "../stores/review";
import type { CorrectionType } from "../types";

const store = useReviewStore();
const message = useMessage();

/* ----------------------------- 提交进度 ----------------------------- */

const progressRows = computed(() =>
  store.schemes.map((scheme) => {
    const required = store.judges.filter((judge) => store.judgeCanReview(judge.id, scheme.id));
    const submitted = required.filter((judge) => {
      const score = store.ownScore(scheme.id, judge.id);
      return !!score?.submitted && !score.selfConflict;
    });
    const recused = store.judges.length - required.length;
    return {
      key: scheme.id,
      code: scheme.code,
      title: scheme.title,
      submitted: submitted.length,
      total: required.length,
      recused,
      ready: required.length > 0 && submitted.length === required.length
    };
  })
);

function lock() {
  try {
    store.lockResults();
    message.success("评分结果已锁定，排名已固化");
  } catch (error) {
    if (error instanceof AccessDeniedError) message.warning(error.message);
  }
}

/* --------------------------- 最终排名（快照） --------------------------- */

const rankColumns = [
  { title: "名次", key: "rank", width: 70 },
  { title: "匿名编号", key: "code" },
  { title: "方案", key: "title" },
  { title: "有效评委数", key: "judgeCount" },
  { title: "自动回避", key: "recused" },
  { title: "自行声明冲突", key: "selfConflicts" },
  { title: "加权总分", key: "total" }
];
const rankData = computed(() =>
  store.ranking.map((item, index) => ({ ...item, rank: index + 1, recused: `${item.recused} 人` }))
);

/* --------------------- 主办方：身份库 / 评委单位维护 --------------------- */

const identityDrafts = reactive<Record<string, { authorsText: string; organization: string }>>({});
for (const identity of store.identities) {
  identityDrafts[identity.schemeId] = { authorsText: identity.authors.join("、"), organization: identity.organization };
}
const judgeDrafts = reactive<Record<string, string>>(
  Object.fromEntries(store.judges.map((judge) => [judge.id, judge.organization]))
);

function saveIdentity(schemeId: string) {
  const draft = identityDrafts[schemeId];
  const authors = draft.authorsText.split(/[、,，\s]+/).map((item) => item.trim()).filter(Boolean);
  if (!authors.length || !draft.organization.trim()) {
    message.warning("作者姓名与申报单位均不能为空");
    return;
  }
  try {
    store.updateIdentity(schemeId, { authors, organization: draft.organization.trim() });
    message.success(store.locked ? "已登记为待更正记录，原排名保留" : "身份信息已更新，回避判定立即重算");
  } catch (error) {
    if (error instanceof AccessDeniedError) message.error(error.message);
  }
}

function saveJudgeOrg(judgeId: string) {
  try {
    store.updateJudgeOrg(judgeId, judgeDrafts[judgeId].trim());
    message.success(store.locked ? "已登记为待更正记录，原排名保留" : "评委申报单位已更新，回避判定立即重算");
  } catch (error) {
    if (error instanceof AccessDeniedError) message.error(error.message);
  }
}

/* ---------------------------- 待更正登记 ---------------------------- */

const correctionForm = reactive<{ type: CorrectionType; schemeCode: string; detail: string }>({
  type: "成绩更正",
  schemeCode: store.schemes[0]?.code ?? "",
  detail: ""
});
const correctionTypes: CorrectionType[] = ["成绩更正", "作者/单位信息更正", "评委申报单位更正"];

function registerCorrection() {
  if (correctionForm.detail.trim().length < 4) {
    message.warning("请填写更正事由（至少4个字）");
    return;
  }
  try {
    store.registerCorrection(
      correctionForm.type,
      correctionForm.detail.trim(),
      correctionForm.type === "成绩更正" ? correctionForm.schemeCode : undefined
    );
    correctionForm.detail = "";
    message.success("已登记待更正记录，锁定时的原排名保留");
  } catch (error) {
    if (error instanceof AccessDeniedError) message.warning(error.message);
  }
}

/* ------------------------------ 审计日志 ------------------------------ */

const eventColumns = [
  { title: "时间", key: "time", width: 170, render: (row: { time: string }) => new Date(row.time).toLocaleString("zh-CN") },
  { title: "操作者", key: "actor", width: 110 },
  { title: "动作", key: "action", width: 170 },
  { title: "详情", key: "detail" }
];
const visibleEvents = computed(() => (store.isOrganizer ? store.events : store.events.filter((event) => event.actor !== "主办方" || event.level === "system")));
</script>

<template>
  <!-- 锁定前：只提示进度，不暴露任何分值 -->
  <NAlert v-if="!store.locked" type="warning" show-icon style="margin-bottom: 16px">
    结果尚未锁定。主办方当前只能看到各方案的提交进度，无法读取任何评分值；评委间评分互不可见。
  </NAlert>
  <NAlert v-else type="success" show-icon style="margin-bottom: 16px">
    结果已于 {{ store.lockedAt ? new Date(store.lockedAt).toLocaleString("zh-CN") : "—" }} 锁定，排名已固化。此后更正只登记待更正记录，不改动原排名。
  </NAlert>

  <div class="result-grid">
    <NCard title="提交进度（按当前回避判定计算应参评人数）">
      <article v-for="row in progressRows" :key="row.key" class="progress-row">
        <div>
          <b>{{ row.code }} {{ row.title }}</b>
          <small>有效评委提交 {{ row.submitted }} / {{ row.total }} · 自动回避 {{ row.recused }} 人</small>
        </div>
        <NTag :type="row.ready ? 'success' : 'warning'">{{ row.ready ? "齐备" : "待提交" }}</NTag>
      </article>
    </NCard>

    <NCard title="评审纪律与锁定">
      <div class="discipline">
        <p>作者身份与匿名编号为两套数据：评委全程只看编号与方案内容。</p>
        <p>回避由系统按评委申报单位、方案作者自动判定；信息一旦变更，判定立即失效重算，受影响的已提交评分退出有效评委数。</p>
        <p>评委越权读取作者姓名或改动他人评分一律拒绝并留痕。</p>
      </div>
      <NButton v-if="store.isOrganizer" type="primary" block :disabled="store.locked" @click="lock">
        {{ store.locked ? "结果已锁定" : store.canLock ? "锁定并发布结果" : "仍有有效评分未提交" }}
      </NButton>
      <p v-else class="aside-note">锁定操作仅主办方可执行。</p>
    </NCard>
  </div>

  <!-- 主办方专属：两套数据中的"身份侧"维护 -->
  <NCard v-if="store.isOrganizer" title="作者身份库（敏感数据 · 仅主办方可读；改动即触发回避重算）" class="admin-card">
    <div class="identity-admin">
      <div v-for="identity in store.identities" :key="identity.schemeId" class="identity-row">
        <div class="identity-head">
          <b>{{ store.schemes.find((s) => s.id === identity.schemeId)?.code }}</b>
          <NTag size="small">身份版本 v{{ identity.version }}</NTag>
        </div>
        <label>作者姓名（顿号分隔）
          <NInput v-model:value="identityDrafts[identity.schemeId].authorsText" placeholder="作者1、作者2" />
        </label>
        <label>申报单位
          <NInput v-model:value="identityDrafts[identity.schemeId].organization" placeholder="作者所属单位" />
        </label>
        <NButton size="small" type="primary" ghost @click="saveIdentity(identity.schemeId)">
          {{ store.locked ? "登记更正" : "保存并重算回避" }}
        </NButton>
      </div>
    </div>
    <div class="judge-admin">
      <div v-for="judge in store.judges" :key="judge.id" class="judge-row">
        <b>{{ judge.name }}</b>
        <NInput v-model:value="judgeDrafts[judge.id]" placeholder="评委申报单位" />
        <NButton size="small" type="primary" ghost @click="saveJudgeOrg(judge.id)">
          {{ store.locked ? "登记更正" : "保存并重算回避" }}
        </NButton>
      </div>
    </div>
    <NAlert type="info" :show-icon="false" class="admin-note">
      锁定前保存：身份版本递增，回避集合立即重算，受影响的已提交评分即刻退出有效评委数；锁定后保存：身份库冻结，仅登记一条待更正记录。
    </NAlert>
  </NCard>

  <NCard title="最终排名" class="ranking">
    <NEmpty v-if="!store.locked" description="锁定前不展示任何评分与排名" />
    <NTable v-else :columns="rankColumns" :data="rankData" :bordered="false" />
  </NCard>

  <!-- 锁定后的更正登记 -->
  <NCard v-if="store.locked" title="待更正记录（只登记、不改原排名）" class="admin-card">
    <div class="correction-form">
      <label>类型
        <select v-model="correctionForm.type">
          <option v-for="item in correctionTypes" :key="item" :value="item">{{ item }}</option>
        </select>
      </label>
      <label v-if="correctionForm.type === '成绩更正'">方案编号
        <select v-model="correctionForm.schemeCode">
          <option v-for="scheme in store.schemes" :key="scheme.id" :value="scheme.code">{{ scheme.code }}</option>
        </select>
      </label>
      <label class="grow">更正事由
        <NInput v-model:value="correctionForm.detail" placeholder="例如：复核发现某维度录入有误，申请复议" />
      </label>
      <NButton type="warning" ghost @click="registerCorrection">登记待更正</NButton>
    </div>
    <NEmpty v-if="!store.corrections.length" description="暂无待更正记录" size="small" />
    <ul v-else class="correction-list">
      <li v-for="item in store.corrections" :key="item.id">
        <NTag size="small" type="warning">{{ item.type }}</NTag>
        <time><NTime :time="Number(new Date(item.createdAt))" format="yyyy-MM-dd HH:mm" /></time>
        <span v-if="item.schemeCode">（{{ item.schemeCode }}）</span>
        <p>{{ item.detail }}</p>
        <small>登记人：{{ item.requester }}</small>
      </li>
    </ul>
  </NCard>

  <!-- 审计：越权拒绝、回避重算全部留痕 -->
  <NCard v-if="store.isOrganizer" title="审计日志（越权拒绝与回避重算留痕）" class="admin-card">
    <NTable :columns="eventColumns" :data="visibleEvents.slice(0, 30)" size="small" :bordered="false" />
  </NCard>
</template>
