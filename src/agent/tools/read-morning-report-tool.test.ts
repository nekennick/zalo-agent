import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { after, before, describe, it } from "node:test";
import { createReadMorningReportTool } from "./read-morning-report-tool.js";
import { ketQuaThanhCong, loiCuaTool } from "./tool-failure-result-test-helper.js";

describe("read_morning_report tool", () => {
  let tempDir: string;

  before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "morning-report-test-"));
  });

  after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("đọc thành công nội dung báo cáo khi file tồn tại", async () => {
    const testFile = path.join(tempDir, "report-ok.txt");
    const mockContent = "📌 Báo cáo sáng hôm nay\nThứ tư, 25/11/2026\n• Lịch thứ tư: 34 chi nhánh";
    await fs.writeFile(testFile, mockContent, "utf-8");

    const tool = createReadMorningReportTool({ filePath: testFile });
    const result = await (tool as any).execute({}, {});

    assert.ok(typeof result === "string");
    assert.ok(ketQuaThanhCong(result));
    assert.match(result, /DỮ LIỆU BÁO CÁO ĐÓNG HÀNG SÁNG/);
    assert.match(result, /Lịch thứ tư: 34 chi nhánh/);
  });

  it("trả về ketQuaLoi khi file không tồn tại", async () => {
    const nonExistentFile = path.join(tempDir, "khong-co-file.txt");

    const tool = createReadMorningReportTool({ filePath: nonExistentFile });
    const result = await (tool as any).execute({}, {});

    const loi = loiCuaTool(result);
    assert.ok(loi, "Phải trả về lỗi");
    assert.match(loi, /Không thể đọc file báo cáo đóng hàng sáng/);
  });

  it("trả về ketQuaLoi khi file rỗng", async () => {
    const emptyFile = path.join(tempDir, "empty.txt");
    await fs.writeFile(emptyFile, "   \n\t  ", "utf-8");

    const tool = createReadMorningReportTool({ filePath: emptyFile });
    const result = await (tool as any).execute({}, {});

    const loi = loiCuaTool(result);
    assert.ok(loi, "Phải trả về lỗi");
    assert.match(loi, /hiện đang rỗng/);
  });

  it("trả về ketQuaLoi khi đường dẫn là thư mục", async () => {
    const tool = createReadMorningReportTool({ filePath: tempDir });
    const result = await (tool as any).execute({}, {});

    const loi = loiCuaTool(result);
    assert.ok(loi, "Phải trả về lỗi");
    assert.match(loi, /không phải là file/);
  });
});
