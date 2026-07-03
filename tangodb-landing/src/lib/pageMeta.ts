function ensureMeta(
  selector: string,
  create: () => HTMLMetaElement,
  content: string,
) {
  let el = document.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = create();
    document.head.appendChild(el);
  }
  el.content = content;
}

type PageMetaInput = {
  title: string;
  description: string;
  imageUrl: string;
  pageUrl: string;
};

export function syncPageMeta({ title, description, imageUrl, pageUrl }: PageMetaInput) {
  document.title = title;

  ensureMeta(
    'meta[name="description"]',
    () => {
      const meta = document.createElement("meta");
      meta.name = "description";
      return meta;
    },
    description,
  );

  const tags: Array<{ selector: string; attr: "name" | "property"; key: string; content: string }> =
    [
      { selector: 'meta[property="og:title"]', attr: "property", key: "og:title", content: title },
      {
        selector: 'meta[property="og:description"]',
        attr: "property",
        key: "og:description",
        content: description,
      },
      {
        selector: 'meta[property="og:image"]',
        attr: "property",
        key: "og:image",
        content: imageUrl,
      },
      { selector: 'meta[property="og:url"]', attr: "property", key: "og:url", content: pageUrl },
      { selector: 'meta[name="twitter:title"]', attr: "name", key: "twitter:title", content: title },
      {
        selector: 'meta[name="twitter:description"]',
        attr: "name",
        key: "twitter:description",
        content: description,
      },
      {
        selector: 'meta[name="twitter:image"]',
        attr: "name",
        key: "twitter:image",
        content: imageUrl,
      },
    ];

  for (const { selector, attr, key, content } of tags) {
    ensureMeta(
      selector,
      () => {
        const meta = document.createElement("meta");
        meta.setAttribute(attr, key);
        return meta;
      },
      content,
    );
  }
}
