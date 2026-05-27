export function UnsupportedBrowserNotice() {
  return (
    <div className="max-w-2xl space-y-4 p-6">
      <h1 className="text-xl font-semibold">지원되지 않는 브라우저</h1>
      <p className="text-sm">
        보드 설치 기능은 Web Serial API가 필요합니다. 데스크톱 Chrome 또는 Edge에서만 동작합니다.
      </p>
      <table className="w-full border text-sm">
        <thead>
          <tr>
            <th className="border p-2">브라우저</th>
            <th className="border p-2">지원 여부</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="border p-2">Chrome / Edge (데스크톱)</td>
            <td className="border p-2 text-green-600">지원</td>
          </tr>
          <tr>
            <td className="border p-2">Safari, Firefox</td>
            <td className="border p-2 text-red-600">미지원</td>
          </tr>
          <tr>
            <td className="border p-2">모바일 브라우저</td>
            <td className="border p-2 text-red-600">미지원</td>
          </tr>
        </tbody>
      </table>
      <a
        href="https://www.google.com/chrome/"
        target="_blank"
        rel="noreferrer"
        className="inline-block rounded bg-blue-600 px-4 py-2 text-white"
      >
        Chrome 다운로드
      </a>
    </div>
  );
}
