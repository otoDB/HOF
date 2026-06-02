import ky from "ky";
import pMap from "p-map";
import * as v from "valibot";

const SOURCE_URL = "https://otodb.github.io/10sen-extract/data.json";
const OUTPUT_PATH = new URL("./src/data/10sen.json", import.meta.url);

const data10sen: Record<
  string,
  { count: number; url: string | null; title: string; type: string }[]
> = await ky.get(SOURCE_URL).json();

type Resolved = {
  year: string;
  count: number;
  title: string;
  url: string | null;
  thumbnail: string | null;
};

const roxySchema = v.object({
  status: v.literal("ok"),
  payload: v.object({
    title: v.string(),
    url: v.string(),
    thumbnail: v.string(),
  }),
});

const jobs = Object.entries(data10sen).flatMap(([y, d]) => {
  console.log(`queueing: ${y} (${d.length} items)`);
  return d.map(({ count, title, url }) => ({ year: y, count, title, url }));
});

async function resolveJob(job: {
  year: string;
  count: number;
  title: string;
  url: string | null;
}): Promise<Resolved> {
  const { year, count, title, url } = job;
  if (!url) {
    return { year, count, title, url, thumbnail: null };
  }

  const roxyUrl = new URL("https://roxy.otodb.net/json");
  roxyUrl.searchParams.set("q", url);

  try {
    const roxyData = v.safeParse(
      roxySchema,
      await ky
        .get(roxyUrl, {
          retry: { limit: 3, methods: ["get"] },
          timeout: 20000,
          throwHttpErrors: false,
        })
        .json(),
    );

    if (!roxyData.success) {
      return { year, count, title, url, thumbnail: null };
    }

    console.log(`resolved: ${url}`);
    return {
      year,
      count,
      url,
      title: roxyData.output.payload.title,
      thumbnail: roxyData.output.payload.thumbnail,
    };
  } catch (e) {
    console.error(e);
    return { year, count, title, url, thumbnail: null };
  }
}

// p-map が同時実行数を絞りつつ、入力順を保った結果配列を返す
const resolved = await pMap(jobs, resolveJob, { concurrency: 24 });

await Bun.write(
  OUTPUT_PATH,
  JSON.stringify(Object.groupBy(resolved, (r) => r.year)),
);
