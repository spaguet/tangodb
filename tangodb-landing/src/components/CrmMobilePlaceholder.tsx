type Props = {
  alt: string;
};

/** Static mobile CRM screenshot in a phone frame for the platform section. */
export function CrmMobilePlaceholder({ alt }: Props) {
  return (
    <figure className="mx-auto w-full max-w-[240px]">
      <div className="rounded-[2rem] border-[3px] border-slate-800 bg-slate-800 p-1.5 shadow-xl shadow-slate-300/50">
        <div className="relative overflow-hidden rounded-[1.6rem] bg-slate-100">
          <div className="flex justify-center pt-2" aria-hidden="true">
            <span className="h-1 w-10 rounded-full bg-slate-300" />
          </div>
          <img
            src="/crm-mobile-overview.png"
            alt={alt}
            className="block w-full h-auto"
            loading="lazy"
            width={390}
            height={844}
          />
        </div>
      </div>
      <figcaption className="sr-only">{alt}</figcaption>
    </figure>
  );
}
