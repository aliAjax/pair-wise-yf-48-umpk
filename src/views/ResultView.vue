<script setup lang="ts">
import { NAlert, NButton, NCard, NEmpty, NTable, NTag, useMessage } from "naive-ui";
import { useReviewStore } from "../stores/review";
const store = useReviewStore();
const message = useMessage();
const columns = [
  { title: "名次", key: "rank", width: 70 },
  { title: "匿名编号", key: "code" },
  { title: "方案", key: "title" },
  { title: "有效评委", key: "judgeCount" },
  { title: "系统回避", key: "recused" },
  { title: "利益冲突", key: "conflicts" },
  { title: "加权总分", key: "total" }
];
function publish() {
  const complete = store.schemes.every((scheme) => store.allSubmittedFor(scheme.id));
  if (!complete) { message.warning("仍有应评评委未提交，不能锁定结果"); return; }
  store.publish();
  message.success("评分结果已锁定发布，原排名冻结保留");
}
</script>
<template>
  <NAlert v-if="!store.published" type="warning" show-icon>结果尚未锁定。为避免影响独立判断，主办方当前只能看到提交进度与有效评委数。</NAlert>
  <div class="result-grid">
    <NCard title="提交进度">
      <article v-for="scheme in store.schemes" :key="scheme.id" class="progress-row">
        <div><b>{{ scheme.code }} {{ scheme.title }}</b>
          <small>有效评分 {{ store.validScoresFor(scheme.id).length }} / 应到 {{ store.expectedJudgesFor(scheme.id).length }} · 已提交 {{ store.judges.filter((judge) => store.scores.some((score) => score.schemeId === scheme.id && score.judge === judge && score.submitted)).length }} / {{ store.judges.length }}</small>
          <small class="muted">系统回避 {{ store.recusedCountFor(scheme.id) }} 人 · 利益冲突 {{ store.scores.filter((score) => score.schemeId === scheme.id && score.conflict).length }} 人</small>
        </div>
        <NTag :type="store.allSubmittedFor(scheme.id) ? 'success' : 'warning'">{{ store.allSubmittedFor(scheme.id) ? "齐备" : "待提交" }}</NTag>
      </article>
    </NCard>
    <NCard title="评分纪律">
      <div class="discipline">
        <p>评委全程只见匿名编号与方案内容，作者身份信息单独存放、不可读取。</p>
        <p>系统按申报单位自动判定回避；信息一旦变更，回避立即重算，受影响评分退出有效评委数。</p>
        <p>锁定后更正只登记为待更正记录，原排名保留不变。</p>
      </div>
      <NButton type="primary" block :disabled="store.published" @click="publish">锁定并发布结果</NButton>
    </NCard>
  </div>
  <NCard v-if="store.published && store.corrections.length" title="待更正记录（锁定后登记，不影响原排名）" class="corrections">
    <article v-for="item in store.corrections" :key="item.id" class="correction-row">
      <NTag size="small" type="info">{{ item.status }}</NTag>
      <div><b>{{ item.targetLabel }} · {{ item.targetType }}</b><small>{{ item.field }}：{{ item.oldValue }} → {{ item.newValue }}<template v-if="item.reason"> · 事由：{{ item.reason }}</template></small></div>
    </article>
  </NCard>
  <NCard title="最终排名" class="ranking"><NEmpty v-if="!store.published" description="锁定后查看最终排名" /><NTable v-else :columns="columns" :data="store.ranking.map((item, index) => ({ ...item, rank: index + 1 }))" :bordered="false" /></NCard>
  <NCard title="审计日志" class="audit">
    <NEmpty v-if="!store.events.length" description="暂无审计事件" />
    <article v-for="event in store.events" :key="event.id" class="audit-row">
      <NTag size="small" :type="event.kind === 'deny' ? 'error' : 'default'">{{ event.kind === 'deny' ? '越权拒绝' : event.action }}</NTag>
      <div><b>{{ event.actor }}</b><small>{{ event.detail }}</small><small class="muted">{{ new Date(event.time).toLocaleString("zh-CN") }}</small></div>
    </article>
  </NCard>
</template>
