<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, RouterView } from "vue-router";
import { useI18n } from "vue-i18n";
import { NMessageProvider, NSelect } from "naive-ui";
import { useReviewStore } from "./stores/review";
import type { ViewerId } from "./types";

const store = useReviewStore();
const { t } = useI18n();

const choices = computed(() => [
  ...store.judges.map((judge) => ({
    label: `评委 · ${judge.name}（${judge.organization}）`,
    value: judge.id as ViewerId
  })),
  { label: "主办方", value: "org" as ViewerId }
]);
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand"><b>ANON</b><span>建筑评审</span></div>
      <nav>
        <RouterLink to="/">{{ t("scoring") }}</RouterLink>
        <RouterLink to="/results">{{ t("results") }}</RouterLink>
      </nav>
      <div class="identity">
        <small>当前身份（演示切换）</small>
        <NSelect :value="store.viewerId" :options="choices" @update:value="(value: ViewerId) => store.setViewer(value)" />
        <small class="hint">评委视图只含匿名编号与方案内容，作者姓名与申报单位在独立身份库中</small>
      </div>
    </aside>
    <main>
      <header>
        <div>
          <small>城市公共空间设计竞赛 · 第二轮</small>
          <h1>建筑设计竞赛匿名评审</h1>
          <p>回避按评委申报单位与方案作者自动判定；评委全程只看编号，看不到作者信息。</p>
        </div>
        <div class="badge">{{ store.isOrganizer ? "主办方视图" : "评委独立视图" }}</div>
      </header>
      <NMessageProvider><RouterView /></NMessageProvider>
    </main>
  </div>
</template>
