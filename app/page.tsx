import type { Metadata } from "next";
import { DrillrDashboard } from "./drillr-dashboard";

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ lang?: string | string[] }> }): Promise<Metadata> {
  const params = await searchParams;
  const language = Array.isArray(params.lang) ? params.lang[0] : params.lang;
  if (language !== "zh") return {};

  const title = "drillr Market Command｜实时自选股驾驶舱";
  const description = "不滚动的高密度实时自选股驾驶舱：先用自选雷达发现变化，再进入单股聚焦页查看可交互五分钟 K 线、实时事件与 200+ 图表化数据标记。";
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [{ url: "/og-zh.png", width: 1280, height: 720, alt: "drillr 实时自选股驾驶舱。" }],
    },
    twitter: { title, description, images: ["/og-zh.png"] },
  };
}

export default function Home() {
  return <DrillrDashboard />;
}
