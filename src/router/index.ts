import { createRouter, createWebHashHistory } from "vue-router";
import ScoreView from "../views/ScoreView.vue";
import ResultView from "../views/ResultView.vue";
import MasterDataView from "../views/MasterDataView.vue";
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", component: ScoreView },
    { path: "/results", component: ResultView },
    { path: "/master-data", component: MasterDataView }
  ]
});
