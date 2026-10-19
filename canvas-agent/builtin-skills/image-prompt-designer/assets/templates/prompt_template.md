# 提示词骨架模板

填空式起草模板。`<...>` 是占位提示，填写后删除尖括号。不需要的块整段删除。
英文 `[TAG]` 保留，标签内用用户工作语言。

---

## 模板 1：img2img 多图合成（产品图 / 套装陈列 / 换背景 / 换装）

```text
[LAYOUT — 来自 image <N>]
完整复刻 image <N> 的<版式骨架/构图>——<布列方式、疏密节奏、留白、投影、光线>。

[PRODUCTS / MODEL & PRODUCT — 来自 image <N>]
<主体>精确呈现 image <N> 原样，颜色/材质/结构与 image <N> 一致。
<主视觉是谁，其余如何分布；只指向图片，不复述部件细节>

[SCENE REFERENCE — 来自 image <N>]   ← 含场景参考图时写全五要素
image <N> 仅作场景参考（SCENE REFERENCE ONLY）。
按 image <N> 重建环境，保持前景/中景/背景景深；光线方向、硬度、色温与 image <N> 一致；
<主体>在<接触面>上有方向一致的投影；画面中不出现 image <N> 里的无关人物/文字/Logo。

[COLOR]   ← 含产品照片/色卡图时写（句式 A/B/C，见 COLOR_AND_BACKGROUND.md）
产品像素精确呈现 image <N> 原色，保持完全饱和，独立于装饰色调。
<有色卡图则逐 HEX 标 BACKGROUND/PRODUCT/DECORATIVE/TEXT ONLY>

[BACKGROUND]
<纯白 #ffffff / 指定背景>，<明亮高调棚拍光 / 指定光线>，仅留极淡接触阴影。

[CAMERA & FOCUS]
<取景视角>，整组清晰对焦、高解析细节。

[POSE]   ← 含人物时写（七要素至少 5 项：重心/手臂/朝向/头角度/动态感/透视/表情）
<重心、手臂、身体朝向、头部角度、动态感、拍摄透视、表情>

技术参数：
--aspect-ratio <比例>
--resolution <2k/4k>
--images "image1路径" "image2路径" ...

【图片引用完备性自检】
  image 1: <文件名> → 引用？✅ 借鉴：<维度>
  image 2: <文件名> → 引用？✅ 借鉴：<维度>
```

---

## 模板 2：txt2img 纯文生图（无参考图 · 概念/海报/场景）

```text
<主体 Subject> + <动作/状态 Action>，
位于 <环境 Environment>，
<构图/镜头 Composition>，
<光线 Lighting>，
<风格/调性 Style，保留 1-2 个抽象调性词>。
<背景与色彩：明确背景色、主色调>。
<画面中只出现…（正向排他）>。

技术参数：
--aspect-ratio <比例>
--resolution <2k/4k>
```

---

## 模板 3：实景图洗白底（多步序列的 Pass 1）

```text
将 image 1 中的<主体>从<实景环境（桌面/房间/户外）>中干净抽离，
单独置于纯白无缝背景 #ffffff 上。
保留 image 1 中<主体>的<角度/结构/文字/图案>原样，<关键文字>清晰锐利。
均匀柔和棚拍光，底部仅一道极淡接触投影。
画面中只有这个<主体>，无任何环境元素。

--aspect-ratio <比例>
--resolution 2k
--images "image1路径"
```

> Pass 2 再把洗白后的产出作为新的 image N，套模板 1 合成。

---

## 起草后必做

对照 `references/PRE_SUBMIT_CHECKLIST.md` 跑一遍 A-G 自检，附上自检表再交付。
