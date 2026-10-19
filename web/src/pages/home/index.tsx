import { ArrowDownRight, ArrowRight, ArrowUpRight, Check, FileText, Image, Layers2, MousePointer2, Plus } from "lucide-react";
import { type CSSProperties, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { navigationTools } from "@/constant/navigation-tools";
import { canvasThemes } from "@/lib/canvas-theme";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useThemeStore } from "@/stores/use-theme-store";
import styles from "./home.module.css";

const scenes = ["ideas", "visual", "plan"] as const;
const creationTools = navigationTools.filter((tool) => ["image", "video", "prompts", "assets"].includes(tool.slug));

export default function HomePage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const hydrated = useCanvasStore((state) => state.hydrated);
    const [scene, setScene] = useState<(typeof scenes)[number]>("visual");
    const createCanvas = () => {
        const state = useCanvasStore.getState();
        if (!state.hydrated) return;
        const id = state.createProject(t("canvas.defaultTitle", { count: state.projects.length + 1 }));
        navigate(`/canvas/${id}`);
    };

    return (
        <main
            className={`${styles.home} h-full overflow-y-auto bg-background text-foreground`}
            style={{
                "--home-panel": theme.node.panel,
                "--home-canvas": theme.canvas.background,
                "--home-line": theme.canvas.line,
                "--home-dot": theme.canvas.dot,
                "--home-stroke": theme.node.stroke,
            } as CSSProperties}
        >
            <div className="mx-auto flex min-h-full max-w-[1440px] flex-col px-6 sm:px-10 lg:px-12">
                <section className="grid flex-1 items-center gap-10 py-14 lg:grid-cols-[0.82fr_1.18fr] lg:gap-8 lg:py-10 xl:gap-14" aria-labelledby="home-title">
                    <div className={styles.intro}>
                        <p className="mb-7 flex items-center gap-3 text-xs tracking-[0.16em] text-muted-foreground">
                            <span className={styles.accentLine} aria-hidden="true" />
                            {t("home.eyebrow")}
                        </p>
                        <h1 id="home-title" className={styles.headline}>
                            {t("home.headlineFirst")}<br />
                            <span className="relative inline-block">
                                {t("home.headlineSecond")}
                                <span className={styles.headlineDot} aria-hidden="true" />
                            </span>
                        </h1>
                        <p className="mt-7 max-w-[28rem] text-pretty text-base leading-[1.9] text-muted-foreground">{t("home.intro")}</p>

                        <div className="mt-9 flex flex-wrap items-center gap-x-7 gap-y-4">
                            <button type="button" disabled={!hydrated} onClick={createCanvas} className={styles.primaryAction}>
                                <Plus className="size-4" />
                                {t("home.createCanvas")}
                                <ArrowUpRight className="ml-4 size-4" />
                            </button>
                            <Link to="/canvas" className={`${styles.textLink} text-sm`}>
                                {t("navigation.canvas")}<ArrowRight className="size-4" />
                            </Link>
                        </div>
                        <div className="mt-10 flex items-start gap-3 text-xs leading-6 text-muted-foreground">
                            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-current opacity-50" aria-hidden="true" />
                            <span>{t("home.localNote")}</span>
                        </div>
                    </div>

                    <div className={`${styles.showcase} w-full min-w-0 max-w-[680px] justify-self-end`}>
                        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-5" role="group" aria-label={t("home.sceneSwitcher")}>
                                {scenes.map((item) => (
                                    <button key={item} type="button" aria-pressed={scene === item} onClick={() => setScene(item)} className={styles.sceneButton}>
                                        {t(`home.scenes.${item}.label`)}
                                    </button>
                                ))}
                            </div>
                            <span className="text-[10px] tracking-wider text-muted-foreground">{t("home.canvasDemo")}</span>
                        </div>

                        <div className={styles.stage} role="img" aria-label={t(`home.scenes.${scene}.accessible`)}>
                            <div key={scene} className={styles.scene} aria-hidden="true">
                                <svg className={styles.connections} viewBox="0 0 720 500" fill="none">
                                    <path d="M220 148 C248 148 232 185 260 185" stroke="var(--home-accent)" strokeWidth="2" />
                                    <path d="M231 355 C250 355 239 316 260 316 M512 237 C571 237 505 371 540 371" stroke="currentColor" strokeWidth="1.5" />
                                    <circle cx="220" cy="148" r="3.5" fill="var(--home-accent)" />
                                    <circle cx="540" cy="371" r="3" fill="currentColor" />
                                </svg>

                                <div className={`${styles.previewNode} ${styles.brief}`}>
                                    <div className={styles.nodeLabel}><FileText />{t("home.briefLabel")}</div>
                                    <p className="mt-3 whitespace-pre-line font-medium leading-relaxed">{t(`home.scenes.${scene}.brief`)}</p>
                                    <div className="mt-4 h-px w-9 bg-current opacity-20" />
                                    <p className="mt-2 text-[0.7em] leading-relaxed text-muted-foreground">{t(`home.scenes.${scene}.detail`)}</p>
                                </div>

                                <div className={`${styles.previewNode} ${styles.note}`}>
                                    <div className={styles.nodeLabel}><Layers2 />{t("home.referenceLabel")}</div>
                                    <p className="mt-3 whitespace-pre-line text-[0.8em] leading-[1.8] text-muted-foreground">{t(`home.scenes.${scene}.references`)}</p>
                                </div>

                                <div className={styles.output}>
                                    <div className={styles.outputLabel}><Image />{t(`home.scenes.${scene}.outputLabel`)}</div>
                                    <div className={styles.poster}>
                                        <span className="text-[0.6em] tracking-[0.18em]">{t("meta.title")}</span>
                                        {scene === "visual" ? (
                                            <>
                                                <span className={styles.posterLogo} />
                                                <strong className={styles.posterTitle}>{t("home.posterTitle")}</strong>
                                            </>
                                        ) : scene === "ideas" ? (
                                            <div className={styles.ideaMap}>
                                                <span>{t("home.ideaRoot")}</span>
                                                <i />
                                                <div>{["ideaObserve", "ideaConnect", "ideaExplore"].map((key) => <span key={key}>{t(`home.${key}`)}</span>)}</div>
                                                <p>{t("home.ideaCaption")}</p>
                                            </div>
                                        ) : (
                                            <div className={styles.plan}>
                                                <strong>{t("home.planTitle")}</strong>
                                                {["planCollect", "planArrange", "planCreate"].map((key, index) => (
                                                    <div key={key}><span>0{index + 1}</span>{t(`home.${key}`)}<Check /></div>
                                                ))}
                                            </div>
                                        )}
                                        <div className="mt-auto flex items-center justify-between border-t border-current/20 pt-3 text-[0.55em] tracking-wider">
                                            <span>{t(`home.scenes.${scene}.posterCaption`)}</span><ArrowUpRight className="size-[1.5em]" />
                                        </div>
                                    </div>
                                    <span className={styles.handle} />
                                </div>

                                <div className={`${styles.previewNode} ${styles.result}`}>
                                    <div className={styles.nodeLabel}><Check />{t("home.resultLabel")}</div>
                                    <p className="mt-2 text-[0.85em] font-medium">{t(`home.scenes.${scene}.result`)}</p>
                                </div>
                                <div className={styles.cursor}><MousePointer2 /><span>{t("home.cursorLabel")}</span></div>
                            </div>
                        </div>
                        <div className="mt-4 flex items-center justify-between gap-4 text-[11px] text-muted-foreground">
                            <span>{t("home.demoCaption")}</span>
                            <span className="flex shrink-0 items-center gap-2"><span className="h-px w-6 bg-current opacity-40" />{t("home.demoEnd")}</span>
                        </div>
                    </div>
                </section>

                <section className="border-t border-border pb-8 pt-6" aria-labelledby="home-tools">
                    <div className="mb-6 flex items-center justify-between gap-4">
                        <h2 id="home-tools" className="text-xs font-normal tracking-wider text-muted-foreground">{t("home.toolsTitle")}</h2>
                        <ArrowDownRight className="size-4 text-muted-foreground" aria-hidden="true" />
                    </div>
                    <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
                        {creationTools.map((tool) => {
                            const Icon = tool.icon;
                            return (
                                <Link key={tool.slug} to={`/${tool.slug}`} className={styles.toolLink}>
                                    <Icon className="mt-0.5 size-5 shrink-0" strokeWidth={1.5} />
                                    <div className="min-w-0 flex-1">
                                        <span className="flex items-center justify-between gap-3 text-sm font-medium">{t(`navigation.${tool.slug}`)}<ArrowUpRight className={styles.toolArrow} /></span>
                                        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{t(`home.tools.${tool.slug}`)}</p>
                                    </div>
                                </Link>
                            );
                        })}
                    </div>
                </section>
                <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-5 text-[11px] text-muted-foreground">
                    <span>{t("home.footer")}</span>
                    <span className="flex items-center gap-2"><span className={styles.footerMark} aria-hidden="true" />{t("meta.title")}</span>
                </footer>
            </div>
        </main>
    );
}
