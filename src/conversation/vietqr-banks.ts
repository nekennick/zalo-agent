export type VietQrBank = {
  bin: string;
  code: string;
  shortName: string;
  name: string;
};

/**
 * Danh sách các ngân hàng Việt Nam hỗ trợ chuẩn VietQR (Napas 247).
 * Cung cấp mã BIN chuẩn và mã định danh rút gọn để gọi API VietQR.
 */
export const VIETQR_BANKS: VietQrBank[] = [
  { bin: "970415", code: "vietinbank", shortName: "VietinBank", name: "Ngân hàng TMCP Công thương Việt Nam" },
  { bin: "970436", code: "vietcombank", shortName: "Vietcombank", name: "Ngân hàng TMCP Ngoại thương Việt Nam" },
  { bin: "970422", code: "mbbank", shortName: "MBBank", name: "Ngân hàng TMCP Quân đội" },
  { bin: "970407", code: "techcombank", shortName: "Techcombank", name: "Ngân hàng TMCP Kỹ thương Việt Nam" },
  { bin: "970416", code: "acb", shortName: "ACB", name: "Ngân hàng TMCP Á Châu" },
  { bin: "970432", code: "vpbank", shortName: "VPBank", name: "Ngân hàng TMCP Việt Nam Thịnh Vượng" },
  { bin: "970418", code: "bidv", shortName: "BIDV", name: "Ngân hàng TMCP Đầu tư và Phát triển Việt Nam" },
  { bin: "970423", code: "tpbank", shortName: "TPBank", name: "Ngân hàng TMCP Tiên Phong" },
  { bin: "970405", code: "agribank", shortName: "Agribank", name: "Ngân hàng Nông nghiệp và Phát triển Nông thôn VN" },
  { bin: "970403", code: "sacombank", shortName: "Sacombank", name: "Ngân hàng TMCP Sài Gòn Thương Tín" },
  { bin: "970437", code: "hdbank", shortName: "HDBank", name: "Ngân hàng TMCP Phát triển TP.HCM" },
  { bin: "970441", code: "vib", shortName: "VIB", name: "Ngân hàng TMCP Quốc tế Việt Nam" },
  { bin: "970443", code: "shb", shortName: "SHB", name: "Ngân hàng TMCP Sài Gòn - Hà Nội" },
  { bin: "970426", code: "msb", shortName: "MSB", name: "Ngân hàng TMCP Hàng Hải Việt Nam" },
  { bin: "970440", code: "seabank", shortName: "SeABank", name: "Ngân hàng TMCP Đông Nam Á" },
  { bin: "970448", code: "ocb", shortName: "OCB", name: "Ngân hàng TMCP Phương Đông" },
  { bin: "970431", code: "eximbank", shortName: "Eximbank", name: "Ngân hàng TMCP Xuất Nhập khẩu Việt Nam" },
  { bin: "970449", code: "lpbank", shortName: "LPBank", name: "Ngân hàng TMCP Lộc Phát Việt Nam" },
  { bin: "546034", code: "cake", shortName: "Cake by VPBank", name: "Ngân hàng số Cake by VPBank" },
  { bin: "963388", code: "timo", shortName: "Timo", name: "Ngân hàng số Timo by BVBank" },
  { bin: "970428", code: "namabank", shortName: "Nam A Bank", name: "Ngân hàng TMCP Nam Á" },
  { bin: "970409", code: "bacabank", shortName: "Bac A Bank", name: "Ngân hàng TMCP Bắc Á" },
  { bin: "970412", code: "pvcombank", shortName: "PVcomBank", name: "Ngân hàng TMCP Đại Chúng Việt Nam" },
  { bin: "970400", code: "saigonbank", shortName: "SaigonBank", name: "Ngân hàng TMCP Sài Gòn Công Thương" },
  { bin: "970438", code: "baovietbank", shortName: "BaoVietBank", name: "Ngân hàng TMCP Bảo Việt" },
  { bin: "970452", code: "kienlongbank", shortName: "KienlongBank", name: "Ngân hàng TMCP Kiên Long" },
];

/**
 * Tìm ngân hàng theo mã BIN, code rút gọn, hoặc tên viết tắt.
 */
export function findBank(query: string): VietQrBank | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;

  return VIETQR_BANKS.find(
    (b) =>
      b.bin === q ||
      b.code.toLowerCase() === q ||
      b.shortName.toLowerCase() === q ||
      b.name.toLowerCase().includes(q),
  );
}
