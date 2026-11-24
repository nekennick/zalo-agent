import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import type { KiotVietProduct } from "./kiotviet-catalog.js";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let rankKiotVietProducts: typeof import("./kiotviet-catalog.js").rankKiotVietProducts;
let dataDir: string;

before(async () => {
  dataDir = setupTestEnv();
  ({ rankKiotVietProducts } = await import("./kiotviet-catalog.js"));
});
after(() => cleanupTestEnv(dataDir));

const pickles: KiotVietProduct = { code: "CM", name: "Cải Muối", unit: "Hộp", category: "Hàng khô" };

it("món cùng nhóm hoặc có chữ trùng một phần không thành gợi ý", () => {
  const catalog = [pickles, { code: "BOTOT", name: "Bột Ớt", unit: "Kg", category: "Hàng khô" }];
  assert.deepEqual(rankKiotVietProducts(catalog, "bò xay", [pickles]), { product: null });
  assert.deepEqual(rankKiotVietProducts(catalog, "bò", [pickles]), { product: null });
});

it("tên đồng hạng và đơn vị lệch đều cần xem lại", () => {
  const equal = { ...pickles, code: "CM2" };
  assert.equal(rankKiotVietProducts([pickles, equal], "cải muối", [], "hộp").ambiguous, true);
  assert.equal(rankKiotVietProducts([pickles], "cải muối", [], "thùng").ambiguous, true);
  assert.equal(rankKiotVietProducts([pickles, equal], "CM", [], "hộp").product?.code, "CM");
  assert.equal(rankKiotVietProducts([pickles], "CM", [], "thùng").ambiguous, true);
  assert.equal(rankKiotVietProducts([pickles, equal], "cải muối", [], "hộp").product, null);
  assert.equal(rankKiotVietProducts([pickles, { ...equal, unit: "thùng" }], "cải muối", [], "thùng").product?.code, "CM2");
});
