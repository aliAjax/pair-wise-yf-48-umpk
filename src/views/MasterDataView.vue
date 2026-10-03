<script setup lang="ts">
import { h, reactive } from "vue";
import { NAlert, NButton, NCard, NInput, NTable, NTag, useMessage } from "naive-ui";
import { useReviewStore } from "../stores/review";
import type { Viewer } from "../types";

const store = useReviewStore();
const message = useMessage();
/** 数据层隔离：评委访问时 authorRows/judgeRows 为空，且本次访问已被拒绝并记入审计 */
const allowed = store.requireOrganizer("进入作者身份库");

const authorDrafts = reactive<Record<string, { realName: string; unit: string; reason: string }>>(
  Object.fromEntries(store.authorRows.map((row) => [row.schemeId, { realName: row.realName, unit: row.unit, reason: "" }]))
);
const judgeDrafts = reactive<Record<string, { unit: string; reason: string }>>(
  Object.fromEntries(store.judgeRows.map((row) => [row.judge as string, { unit: row.unit, reason: "" }]))
);

function saveAuthor(schemeId: string) {
  const draft = authorDrafts[schemeId];
  if (!draft) return;
  store.submitAuthorEdit(schemeId, { realName: draft.realName, unit: draft.unit }, draft.reason);
  message.success(store.published ? "已登记为待更正记录，原排名保留" : "作者信息已更新，回避判定已即时重算");
  draft.reason = "";
}

function saveJudge(judgeName: Viewer) {
  const draft = judgeDrafts[judgeName];
  if (!draft) return;
  store.submitJudgeUnitEdit(judgeName, draft.unit, draft.reason);
  message.success(store.published ? "已登记为待更正记录，原排名保留" : "评委申报单位已更新，回避判定已即时重算");
  draft.reason = "";
}

const authorColumns = [
  { title: "匿名编号", key: "code", width: 90 },
  { title: "方案", key: "title", width: 160 },
  {
    title: "作者姓名（受限）", key: "realName", width: 170,
    render: (row: { schemeId: string }) => h(NInput, {
      value: authorDrafts[row.schemeId]?.realName ?? "",
      "onUpdate:value": (value: string) => { if (authorDrafts[row.schemeId]) authorDrafts[row.schemeId].realName = value; }
    })
  },
  {
    title: "申报单位（受限）", key: "unit",
    render: (row: { schemeId: string }) => h(NInput, {
      value: authorDrafts[row.schemeId]?.unit ?? "",
      "onUpdate:value": (value: string) => { if (authorDrafts[row.schemeId]) authorDrafts[row.schemeId].unit = value; }
    })
  },
  {
    title: "系统回避预览", key: "recused", width: 180,
    render: (row: { schemeId: string }) => h("div", { class: "recused-preview" },
      store.judges.filter((judge) => store.isRecused(judge, row.schemeId)).map((judge) => h(NTag, { size: "small", type: "warning" }, { default: () => judge }))
    )
  },
  {
    title: "变更事由", key: "reason", width: 180,
    render: (row: { schemeId: string }) => h(NInput, {
      value: authorDrafts[row.schemeId]?.reason ?? "",
      placeholder: "选填",
      "onUpdate:value": (value: string) => { if (authorDrafts[row.schemeId]) authorDrafts[row.schemeId].reason = value; }
    })
  },
  {
    title: "操作", key: "op", width: 90,
    render: (row: { schemeId: string }) => h(NButton, { size: "small", type: "primary", onClick: () => saveAuthor(row.schemeId) }, { default: () => (store.published ? "登记更正" : "保存并重算回避") })
  }
];

const judgeColumns = [
  { title: "评委", key: "judge", width: 160 },
  {
    title: "申报单位", key: "unit",
    render: (row: { judge: Viewer }) => h(NInput, {
      value: judgeDrafts[row.judge]?.unit ?? "",
      "onUpdate:value": (value: string) => { if (judgeDrafts[row.judge]) judgeDrafts[row.judge].unit = value; }
    })
  },
  {
    title: "变更事由", key: "reason", width: 200,
    render: (row: { judge: string }) => h(NInput, {
      value: judgeDrafts[row.judge]?.reason ?? "",
      placeholder: "选填",
      "onUpdate:value": (value: string) => { if (judgeDrafts[row.judge]) judgeDrafts[row.judge].reason = value; }
    })
  },
  {
    title: "操作", key: "op", width: 140,
    render: (row: { judge: Viewer }) => h(NButton, { size: "small", type: "primary", onClick: () => saveJudge(row.judge) }, { default: () => (store.published ? "登记更正" : "保存并重算回避") })
  }
];
</script>

<template>
  <NAlert v-if="!allowed" type="error" show-icon>
    无权访问作者身份库：评委全程只能看到匿名编号与方案内容，本次读取作者姓名/申报单位已被拒绝并记入审计日志。
  </NAlert>
  <template v-else>
    <NAlert type="info" show-icon class="master-note">
      两套数据分离：评委可见的只有匿名方案；作者姓名与申报单位为受限数据。系统按评委与作者的申报单位自动判定回避，任一方信息变更后回避立即重算，受影响的已提交评分退出有效评委数。
    </NAlert>
    <NCard title="作者身份库（仅主办方可见）" class="master-card">
      <NTable :columns="authorColumns" :data="store.schemes.map((scheme) => ({ schemeId: scheme.id, code: scheme.code, title: scheme.title }))" :bordered="false" />
    </NCard>
    <NCard title="评委申报单位（仅主办方维护）" class="master-card">
      <NTable :columns="judgeColumns" :data="store.judgeRows" :bordered="false" />
    </NCard>
    <NAlert v-if="store.published" type="warning" show-icon class="master-note">
      结果已锁定：以上变更不会改动原数据与排名，只登记为待更正记录；原排名保留不变。
    </NAlert>
    <NCard title="待更正记录" class="master-card">
      <NAlert v-if="!store.corrections.length" type="info" show-icon>暂无待更正记录。</NAlert>
      <article v-for="item in store.corrections" :key="item.id" class="correction-row">
        <NTag size="small" type="info">{{ item.status }}</NTag>
        <div><b>{{ item.targetLabel }} · {{ item.targetType }}</b><small>{{ item.field }}：{{ item.oldValue }} → {{ item.newValue }}<template v-if="item.reason"> · 事由：{{ item.reason }}</template></small><small class="muted">{{ new Date(item.time).toLocaleString("zh-CN") }}</small></div>
      </article>
    </NCard>
  </template>
</template>
