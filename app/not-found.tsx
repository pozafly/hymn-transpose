import Link from "next/link";
export default function NotFound() {
  return (
    <main className="not-found">
      <p className="eyebrow">찬송의 조</p>
      <h1>악보를 찾을 수 없어요.</h1>
      <p>곡 목록에서 다시 골라 주세요.</p>
      <Link className="button primary" href="/">
        곡 목록으로
      </Link>
    </main>
  );
}
