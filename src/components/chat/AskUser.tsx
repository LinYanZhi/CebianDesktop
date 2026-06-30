import { useState } from "react";

// ─── 本地类型定义 ───

type AskQuestion = {
  id: string;
  type: string;
  question: string;
  message?: string;
  placeholder?: string;
  options?: { label: string; value: string; description?: string; recommended?: boolean }[];
  required?: boolean;
  allow_free_text?: boolean;
  min_select?: number;
  max_select?: number;
  step?: number;
  step_title?: string;
};

type PaginationType = {
  type: "wizard";
  show_progress?: boolean;
  allow_skip?: boolean;
  allow_review?: boolean;
};

// ═══════════════════════════════════════════════════════════
//  交互式 AskUser 表单（对话区域内嵌，由 AI 动态控制）
//  支持三种模式：
//    A. Compact 紧凑模式（单字段、无标题、无提交按钮）
//    B. Form 表单模式（多字段或有标题）
//    C. Wizard 分步向导模式（pagination.type === "wizard"）
// ═══════════════════════════════════════════════════════════

/** 单个字段的渲染组件 */
function FormFieldWidget({
  field, value, onChange, error
}: {
  field: AskQuestion;
  value: string | string[];
  onChange: (v: string | string[]) => void;
  error?: string;
}) {
  const type = field.type || "text";
  const hasError = !!error;
  const options = field.options || [];

  // ── textarea ──
  if (type === "textarea") {
    return (
      <div>
        <textarea
          value={value as string}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder || ""}
          rows={3}
          className={`w-full px-3 py-2 rounded-lg border text-sm bg-background text-foreground placeholder:text-muted-foreground/40 outline-none transition-colors resize-y ${
            hasError ? "border-red-400" : "border-border focus:border-primary/50"
          }`}
          autoFocus
        />
        {hasError && <p className="text-xs text-red-400 mt-1">{error}</p>}
      </div>
    );
  }

  // ── dropdown ──
  if (type === "dropdown") {
    return (
      <div>
        <select
          value={value as string}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full px-3 py-2 rounded-lg border text-sm bg-background text-foreground outline-none transition-colors ${
            hasError ? "border-red-400" : "border-border focus:border-primary/50"
          }`}
        >
          <option value="" disabled>请选择...</option>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label} {opt.recommended ? "★" : ""}
            </option>
          ))}
        </select>
        {hasError && <p className="text-xs text-red-400 mt-1">{error}</p>}
      </div>
    );
  }

  // ── single_select（标准 radio） ──
  if (type === "single_select") {
    return (
      <div>
        <div className="space-y-1.5">
          {options.map((opt) => (
            <label key={opt.value}
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border cursor-pointer text-xs transition-colors hover:bg-accent/50 ${
                value === opt.value ? "border-primary bg-primary/10" : "border-border"
              }`}
            >
              <input type="radio" name="ss" value={opt.value}
                checked={value === opt.value}
                onChange={(e) => onChange(e.target.value)}
                className="size-3.5 accent-primary shrink-0"
              />
              <span className="flex-1">{opt.label}</span>
              {opt.recommended && (
                <span className="text-[0.6rem] text-primary/70 font-medium px-1 py-0.5 rounded bg-primary/10 shrink-0">
                  推荐
                </span>
              )}
            </label>
          ))}
        </div>
        {field.allow_free_text && (
          <input type="text" value={value as string}
            onChange={(e) => onChange(e.target.value)}
            placeholder="自定义输入..."
            className={`mt-2 w-full px-3 py-2 rounded-lg border text-sm bg-background text-foreground placeholder:text-muted-foreground/40 outline-none transition-colors ${
              hasError ? "border-red-400" : "border-border focus:border-primary/50"
            }`}
          />
        )}
        {hasError && <p className="text-xs text-red-400 mt-1">{error}</p>}
      </div>
    );
  }

  // ── multi_select（标准 checkbox） ──
  if (type === "multi_select") {
    const selected = (value as string[]) || [];
    return (
      <div>
        <div className="space-y-1.5">
          {options.map((opt) => {
            const isSelected = selected.includes(opt.value);
            return (
              <label key={opt.value}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border cursor-pointer text-xs transition-colors hover:bg-accent/50 ${
                  isSelected ? "border-primary bg-primary/10" : "border-border"
                }`}
              >
                <input type="checkbox" value={opt.value}
                  checked={isSelected}
                  onChange={() => {
                    if (isSelected) {
                      onChange(selected.filter((v) => v !== opt.value));
                    } else {
                      if (field.max_select && selected.length >= field.max_select) return;
                      onChange([...selected, opt.value]);
                    }
                  }}
                  className="size-3.5 accent-primary rounded shrink-0"
                />
                <span className="flex-1">{opt.label}</span>
                {opt.recommended && (
                  <span className="text-[0.6rem] text-primary/70 font-medium px-1 py-0.5 rounded bg-primary/10 shrink-0">
                    推荐
                  </span>
                )}
              </label>
            );
          })}
        </div>
        {selected.length > 0 && field.min_select !== undefined && selected.length < field.min_select && (
          <p className="text-xs text-amber-400 mt-1">至少选择 {field.min_select} 项</p>
        )}
        {field.allow_free_text && (
          <div className="mt-2 flex gap-1.5">
            <input type="text"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.target as HTMLInputElement).value.trim()) {
                  const val = (e.target as HTMLInputElement).value.trim();
                  if (!selected.includes(val)) {
                    onChange([...selected, val]);
                  }
                  (e.target as HTMLInputElement).value = "";
                }
              }}
              placeholder="输入自定义项后按 Enter..."
              className="flex-1 px-3 py-2 rounded-lg border border-border text-sm bg-background text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/50 transition-colors"
            />
          </div>
        )}
      </div>
    );
  }

  // ── text（默认） ──
  return (
    <div>
      <input type="text" value={value as string}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder || "输入..."}
        className={`w-full px-3 py-2 rounded-lg border text-sm bg-background text-foreground placeholder:text-muted-foreground/40 outline-none transition-colors ${
          hasError ? "border-red-400" : "border-border focus:border-primary/50"
        }`}
        autoFocus
      />
      {hasError && <p className="text-xs text-red-400 mt-1">{error}</p>}
    </div>
  );
}

// ─── 表单校验 ───

function validateForm(
  questions: AskQuestion[],
  values: Record<string, string | string[]>,
): Record<string, string> {
  const errs: Record<string, string> = {};
  for (const q of questions) {
    if (q.required) {
      const v = values[q.id];
      if (q.type === "multi_select") {
        if (!Array.isArray(v) || v.length === 0) errs[q.id] = "此项为必填";
        else if (q.min_select && v.length < q.min_select)
          errs[q.id] = `至少选择 ${q.min_select} 项`;
      } else if (!v || (typeof v === "string" && !v.trim())) {
        errs[q.id] = "此项为必填";
      }
    }
  }
  return errs;
}

// ─── Mode A: Compact 紧凑模式（单字段、无标题、无提交按钮） ───

function AskUserCompactBlock({
  field, onResolve
}: {
  field: AskQuestion;
  onResolve: (value: string | null) => void;
}) {
  const [value, setValue] = useState<string | string[]>(() => {
    if (field.type === "multi_select") return [];
    return "";
  });
  const [error, setError] = useState<string | null>(null);
  const type = field.type || "text";
  const isConfirm = type === "confirm";

  // confirm 模式
  if (isConfirm) {
    return (
      <div className="my-3 p-4 rounded-xl border bg-card shadow-sm animate-form-enter">
        <div className="text-sm whitespace-pre-wrap text-foreground mb-3">{field.question}</div>
        <div className="flex gap-2">
          <button onClick={() => onResolve("yes")}
            className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
            确认
          </button>
          <button onClick={() => onResolve("no")}
            className="px-4 py-1.5 rounded-lg border border-border text-foreground text-sm hover:bg-accent transition-colors">
            取消
          </button>
        </div>
      </div>
    );
  }

  // 有 options → single_select 紧凑模式（选项按钮 + 可取消）
  const hasOptions = (field.options && field.options.length > 0) || false;
  if (hasOptions) {
    return (
      <div className="my-3 p-4 rounded-xl border bg-card shadow-sm animate-form-enter">
        <div className="text-sm whitespace-pre-wrap text-foreground mb-3">{field.question}</div>
        <div className="flex flex-wrap gap-2">
          {field.options?.map((opt) => (
            <button key={opt.value} onClick={() => onResolve(opt.value)}
              className="px-3 py-1.5 rounded-lg text-sm border border-border hover:bg-accent hover:text-foreground text-muted-foreground transition-colors"
            >
              {opt.label}
            </button>
          ))}
          <button onClick={() => onResolve(null)}
            className="px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-colors">
            取消
          </button>
        </div>
      </div>
    );
  }

  // text/textarea 紧凑模式
  const handleSubmit = () => {
    if ((typeof value === "string" && !value.trim()) || (Array.isArray(value) && value.length === 0)) {
      setError("此项为必填");
      return;
    }
    const result: Record<string, any> = {};
    result[field.id] = field.type === "multi_select" ? value : (typeof value === "string" ? value : "");
    onResolve(JSON.stringify(result));
  };

  return (
    <div className="my-3 p-4 rounded-xl border bg-card shadow-sm animate-form-enter">
      <div className="text-sm whitespace-pre-wrap text-foreground mb-3">{field.question}</div>
      <FormFieldWidget field={field} value={value} onChange={(v) => { setValue(v); setError(null); }} error={error || undefined} />
      <div className="flex gap-2 mt-3">
        <button onClick={handleSubmit}
          className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
          确认
        </button>
        <button onClick={() => onResolve(null)}
          className="px-4 py-1.5 rounded-lg border border-border text-muted-foreground text-sm hover:bg-accent transition-colors">
          取消
        </button>
      </div>
    </div>
  );
}

// ─── Mode B: 表单模式（多字段或有标题） ───

function FormBlock({
  title, description, submit_label, questions, onResolve
}: {
  title?: string;
  description?: string;
  submit_label?: string;
  questions: AskQuestion[];
  onResolve: (value: string | null) => void;
}) {
  const [values, setValues] = useState<Record<string, string | string[]>>(() => {
    const init: Record<string, string | string[]> = {};
    for (const q of questions) {
      if (q.type === "multi_select") init[q.id] = [];
      else init[q.id] = "";
    }
    return init;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const updateField = (id: string, v: string | string[]) => {
    setValues((prev) => ({ ...prev, [id]: v }));
    setErrors((prev) => { const n = { ...prev }; delete n[id]; return n; });
  };

  const handleSubmit = () => {
    if (submitting) return;
    const errs = validateForm(questions, values);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setSubmitting(true);
    const result: Record<string, any> = {};
    for (const q of questions) {
      const v = values[q.id];
      result[q.id] = q.type === "multi_select" ? (Array.isArray(v) ? v : []) : (typeof v === "string" ? v : "");
    }
    onResolve(JSON.stringify(result));
  };

  return (
    <div className="my-3 rounded-xl border bg-card shadow-sm overflow-hidden animate-form-enter">
      {title && (
        <div className="px-4 pt-4 pb-1">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {description && (
            <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{description}</p>
          )}
        </div>
      )}
      <div className="px-4 py-3 space-y-4">
        {questions.map((q) => (
          <div key={q.id}>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              {q.question}
              {q.required && <span className="text-red-400 ml-0.5">*</span>}
            </label>
            {q.message && (
              <p className="text-xs text-muted-foreground mb-2">{q.message}</p>
            )}
            <FormFieldWidget field={q} value={values[q.id] ?? ""} onChange={(v) => updateField(q.id, v)} error={errors[q.id]} />
          </div>
        ))}
      </div>
      <div className="px-4 pb-4 flex gap-2">
        <button onClick={handleSubmit} disabled={submitting}
          className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
          {submit_label || "提交"}
        </button>
        <button onClick={() => { setSubmitting(true); onResolve(null); }} disabled={submitting}
          className="px-4 py-1.5 rounded-lg border border-border text-muted-foreground text-sm hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
          取消
        </button>
      </div>
    </div>
  );
}

// ─── Mode C: Wizard 分步向导模式 ───

function WizardBlock({
  title, description, submit_label, pagination, questions, onResolve
}: {
  title?: string;
  description?: string;
  submit_label?: string;
  pagination?: PaginationType;
  questions: AskQuestion[];
  onResolve: (value: string | null) => void;
}) {
  // 按 step 分组
  const steps = (() => {
    const map = new Map<number, { id: number; title?: string; questions: typeof questions }>();
    for (const q of questions) {
      const stepNum = q.step ?? 1;
      if (!map.has(stepNum)) map.set(stepNum, { id: stepNum, title: q.step_title, questions: [] });
      const step = map.get(stepNum)!;
      if (q.step_title && !step.title) step.title = q.step_title;
      step.questions.push(q);
    }
    return Array.from(map.values()).sort((a, b) => a.id - b.id);
  })();

  const showProgress = pagination?.show_progress !== false;
  const allowReview = pagination?.allow_review !== false;
  const allowSkip = pagination?.allow_skip === true;

  const allSteps = allowReview ? [...steps, { id: -1, title: "确认", questions: [] }] : steps;
  const [currentIdx, setCurrentIdx] = useState(0);
  const [values, setValues] = useState<Record<string, string | string[]>>(() => {
    const init: Record<string, string | string[]> = {};
    for (const q of questions) {
      if (q.type === "multi_select") init[q.id] = [];
      else init[q.id] = "";
    }
    return init;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const updateField = (id: string, v: string | string[]) => {
    setValues((prev) => ({ ...prev, [id]: v }));
    setErrors((prev) => { const n = { ...prev }; delete n[id]; return n; });
  };

  const currentStep = allSteps[currentIdx];
  const isReviewStep = allowReview && currentIdx === allSteps.length - 1;
  const currentQuestions = isReviewStep ? questions : (currentStep && 'questions' in currentStep ? (currentStep as any).questions : []);

  const handleNext = () => {
    // 校验当前步骤
    if (!isReviewStep) {
      const stepQs = (currentStep as any).questions || [];
      const stepErrs = validateForm(stepQs, values);
      setErrors(stepErrs);
      if (Object.keys(stepErrs).length > 0) return;
    }
    if (currentIdx < allSteps.length - 1) {
      setCurrentIdx(currentIdx + 1);
    }
  };

  const handlePrev = () => {
    if (currentIdx > 0) setCurrentIdx(currentIdx - 1);
  };

  const handleSubmit = () => {
    if (submitting) return;
    const errs = validateForm(questions, values);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setSubmitting(true);
    const result: Record<string, any> = {};
    for (const q of questions) {
      const v = values[q.id];
      result[q.id] = q.type === "multi_select" ? (Array.isArray(v) ? v : []) : (typeof v === "string" ? v : "");
    }
    onResolve(JSON.stringify(result));
  };

  return (
    <div className="my-3 rounded-xl border bg-card shadow-sm overflow-hidden animate-form-enter">
      {/* 进度条 */}
      {showProgress && allSteps.length > 1 && (
        <div className="px-4 pt-4 pb-2">
          <div className="flex items-center gap-1">
            {allSteps.map((_, i) => (
              <div key={i} className={`flex-1 h-1 rounded-full transition-colors ${
                i <= currentIdx ? "bg-primary" : "bg-border"
              }`} />
            ))}
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-[10px] text-muted-foreground">
              {title || (typeof (currentStep as any)?.title === "string" ? (currentStep as any).title : `步骤 ${currentIdx + 1}/${allSteps.length}`)}
            </span>
            <span className="text-[10px] text-muted-foreground">{currentIdx + 1}/{allSteps.length}</span>
          </div>
        </div>
      )}

      {/* 标题 */}
      {title && (
        <div className="px-4 pt-2 pb-1">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {description && (
            <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{description}</p>
          )}
        </div>
      )}

      {/* Review 步骤 */}
      {isReviewStep ? (
        <div className="px-4 py-3 space-y-3">
          <p className="text-sm font-medium text-foreground">请确认以下信息</p>
          {questions.map((q) => {
            const v = values[q.id];
            const display = q.type === "multi_select"
              ? (Array.isArray(v) ? (v as string[]).join(", ") : "")
              : (typeof v === "string" ? v : "");
            return (
              <div key={q.id} className="text-xs">
                <span className="text-muted-foreground">{q.question}：</span>
                <span className="text-foreground font-medium">{display || "（未填写）"}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="px-4 py-3 space-y-4">
          {(currentQuestions || []).map((q: any) => (
            <div key={q.id}>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                {q.question}
                {q.required && <span className="text-red-400 ml-0.5">*</span>}
              </label>
              {q.message && (
                <p className="text-xs text-muted-foreground mb-2">{q.message}</p>
              )}
              <FormFieldWidget field={q} value={values[q.id] ?? ""} onChange={(v) => updateField(q.id, v)} error={errors[q.id]} />
            </div>
          ))}
        </div>
      )}

      {/* 导航按钮 */}
      <div className="px-4 pb-4 flex items-center justify-between">
        <div>
          {currentIdx > 0 && (
            <button onClick={handlePrev}
              className="px-3 py-1.5 rounded-lg border border-border text-muted-foreground text-sm hover:bg-accent transition-colors">
              上一步
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {allowSkip && !isReviewStep && currentIdx < allSteps.length - 1 && (
            <button onClick={() => setCurrentIdx(currentIdx + 1)}
              className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors">
              跳过
            </button>
          )}
          {isReviewStep ? (
            <button onClick={handleSubmit} disabled={submitting}
              className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              {submit_label || "提交"}
            </button>
          ) : (
            <button onClick={handleNext}
              className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
              {currentIdx < allSteps.length - 1 ? "下一步" : "确认"}
            </button>
          )}
          <button onClick={() => { setSubmitting(true); onResolve(null); }} disabled={submitting}
            className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40">
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── 主分发组件 ───

export function AskUserBlock({
  title, description, submit_label, pagination, questions, onResolve
}: {
  title?: string;
  description?: string;
  submit_label?: string;
  pagination?: PaginationType;
  questions: AskQuestion[];
  onResolve: (value: string | null) => void;
}) {
  // Mode C: Wizard 分步向导
  if (pagination?.type === "wizard") {
    return (
      <WizardBlock title={title} description={description} submit_label={submit_label} pagination={pagination} questions={questions} onResolve={onResolve} />
    );
  }

  // Mode A: Compact 紧凑模式（单字段、无标题、无 description）
  if (questions.length === 1 && !title && !description) {
    return <AskUserCompactBlock field={questions[0]} onResolve={onResolve} />;
  }

  // Mode B: 表单模式
  return (
    <FormBlock title={title} description={description} submit_label={submit_label} questions={questions} onResolve={onResolve} />
  );
}
