<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { NAlert, NButton, NCard, NInput, NInputNumber, NProgress, NSlider, NSwitch, NTag, useMessage } from "naive-ui";
import { useReviewStore, AccessDeniedError } from "../stores/review";

const store = useReviewStore();
const message = useMessage();
const selectedId = defineModel<string>("selectedId", { default: "a" });

const selected = computed(() => store.schemes.find((item) => item.id === selectedId.value) ?? store.schemes[0]);
const isRecused = computed(() => (store.currentJudge ? store.isRecused(store.currentJudge.id, selected.value.id) : false));
const ownScore = computed(() => store.ownScore(selected.value.id));

/** 本人已提交、但因身份/单位变更导致回避重算而失效的评分 */
const myInvalidated = computed(() =>
  store.invalidatedScores.filter((score) => score.judgeId === store.viewerId)
);

const form = reactive({
  values: Object.fromEntries(store.criteria.map((item) => [item.id, 60])) as Record<string, number>,
  comment: "",
  selfConflict: false
});
const commentError = ref("");

function loadForm() {
  const record = ownScore.value;
  form.values = { ...(record?.values ?? Object.fromEntries(store.criteria.map((item) => [item.id, 60]))) };
  form.comment = record?.comment ?? "";
  form.selfConflict = record?.selfConflict ?? false;
}

watch([selectedId, () => store.scores.length, () => store.recusalVersion], loadForm, { immediate: true });

const weighted = computed(() => store.criteria.reduce((sum, item) => sum + form.values[item.id] * item.weight / 100, 0));
const disabled = computed(() => store.isOrganizer || isRecused.value || !!ownScore.value?.submitted || store.locked);

function ownStatus(schemeId: string) {
  if (store.isOrganizer) return "—";
  if (store.isRecused(store.viewerId, schemeId)) return "应回避";
  const record = store.ownScore(schemeId);
  if (!record) return "待评分";
  if (record.submitted) return store.isScoreActive(record) ? "已提交" : "已提交·回避失效";
  return "评分中";
}

function deny(error: unknown, fallback: string) {
  if (error instanceof AccessDeniedError) {
    // 拒绝事件已在 store 内登记审计日志，这里仅提示当前用户
    message.error(error.message);
  } else {
    message.error(fallback);
  }
}

async function persist(mode: "draft" | "submit") {
  try {
    if (mode === "draft") {
      store.saveDraft(selected.value.id, form.values, form.comment, form.selfConflict);
      message.success("评分草稿已保存到本地");
    } else {
      if (form.comment.trim().length < 4) {
        commentError.value = "请至少填写4个字的评审意见";
        return;
      }
      commentError.value = "";
      store.submit(selected.value.id, form.values, form.comment, form.selfConflict);
      message.success("匿名评分已提交");
    }
  } catch (error) {
    deny(error, "操作被拒绝");
  }
}

function draft() {
  void persist("draft");
}
async function submit() {
  await persist("submit");
}
function recall() {
  try {
    store.recall(selected.value.id);
    message.success("已退回为可修改状态");
  } catch (error) {
    deny(error, "退回被拒绝");
  }
}

/** 模拟越权：尝试以当前评委身份读取他人/作者信息（应被系统拒绝） */
const probeResult = ref("");
function probeAuthorIdentity() {
  try {
    store.getIdentity(selected.value.id);
    probeResult.value = "异常：读取未被拦截";
  } catch (error) {
    probeResult.value = error instanceof AccessDeniedError ? `已拒绝：${error.message}` : "已拒绝";
  }
}
</script>

<template>
  <NAlert v-if="store.isOrganizer" type="info" show-icon>
    主办方身份不能评分；锁定前只能查看提交进度，任何评委的评分值均不可读。
  </NAlert>

  <NAlert v-else-if="myInvalidated.length" type="error" show-icon style="margin-bottom: 14px">
    回避判定已重算：您有 {{ myInvalidated.length }} 份已提交评分因申报单位/作者信息变更命中回避，已自动退出有效评委数，无法继续操作该方案。
  </NAlert>

  <div class="workspace">
    <NCard title="匿名方案（仅编号与内容）" class="scheme-panel">
      <button
        v-for="item in store.schemes"
        :key="item.id"
        class="scheme"
        :class="{ active: selectedId === item.id, blocked: store.isRecused(store.viewerId, item.id) && !store.isOrganizer }"
        @click="selectedId = item.id"
      >
        <span>{{ item.code }}</span>
        <b>{{ item.title }}</b>
        <small>{{ item.publicNo }} · {{ ownStatus(item.id) }}</small>
      </button>
    </NCard>

    <NCard class="score-panel">
      <template #header>
        <div class="card-title">
          <div>
            <small>{{ selected.code }} · {{ selected.publicNo }}</small>
            <h2>{{ selected.title }}</h2>
          </div>
          <NTag :type="isRecused ? 'error' : ownScore?.submitted ? 'success' : 'warning'">
            {{ store.isOrganizer ? "主办方不可评分" : ownStatus(selected.id) }}
          </NTag>
        </div>
      </template>

      <!-- 命中回避：只显示拒绝提示，不展示方案内容与任何身份字段 -->
      <NAlert v-if="!store.isOrganizer && isRecused" type="error" title="系统已自动判定回避" show-icon style="margin: 8px 0">
        评委申报单位或姓名与该方案作者/申报单位存在关联，该方案内容对您封死，您不能评分或查看；您的评分也不会计入该方案。
      </NAlert>

      <template v-else>
        <p class="synopsis">{{ selected.synopsis }}</p>
        <p class="masked-line">
          作者身份库状态：作者 {{ store.maskedIdentity(selected.id).authors.join("") }}
          ｜申报单位 {{ store.maskedIdentity(selected.id).organization }}
          ｜身份版本 v{{ store.maskedIdentity(selected.id).version }}
        </p>
        <div class="criteria">
          <article v-for="item in store.criteria" :key="item.id">
            <div>
              <b>{{ item.name }}</b>
              <span>权重 {{ item.weight }}%</span>
              <p>{{ item.description }}</p>
            </div>
            <div class="score-input">
              <NSlider v-model:value="form.values[item.id]" :min="0" :max="item.max" :disabled="disabled" />
              <NInputNumber v-model:value="form.values[item.id]" :min="0" :max="item.max" :disabled="disabled" size="small" />
              <small>/ {{ item.max }}</small>
            </div>
          </article>
        </div>
        <div class="weighted">
          <span>加权得分</span>
          <NProgress type="line" :percentage="weighted" :height="18" />
          <b>{{ weighted.toFixed(1) }}</b>
        </div>
        <label class="conflict-switch">
          <NSwitch v-model:value="form.selfConflict" :disabled="disabled" />
          <span>
            <b>自行声明其他利益冲突</b>
            <small>单位/作者关联由系统自动回避；此处仅用于声明其余关联，声明后本评分不计入排名</small>
          </span>
        </label>
        <label class="field">
          <span>评审意见（评委间互不可见）</span>
          <NInput v-model:value="form.comment" type="textarea" :disabled="disabled" placeholder="填写对方案的具体意见" />
          <small>{{ commentError }}</small>
        </label>
        <div class="actions">
          <NButton :disabled="disabled" @click="draft">保存草稿</NButton>
          <NButton type="primary" :disabled="disabled" @click="submit">提交本方案评分</NButton>
          <NButton v-if="ownScore?.submitted && !store.locked" quaternary @click="recall">退回修改</NButton>
          <NButton quaternary size="small" @click="probeAuthorIdentity">越权读取作者（应被拒绝）</NButton>
          <span v-if="probeResult" class="probe">{{ probeResult }}</span>
        </div>
      </template>
    </NCard>
  </div>
</template>
