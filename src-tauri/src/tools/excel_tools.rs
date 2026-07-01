use std::collections::BTreeMap;
use std::path::Path;

use calamine::{open_workbook_auto, Data, Reader};
use regex::Regex;
use rust_xlsxwriter::*;
use serde_json::{json, Value};

// ─── 辅助函数 ────────────────────────────────────────────

/// 将 calamine 的 Data 类型转换为 serde_json::Value
fn cell_to_json(cell: &Data) -> Value {
    match cell {
        Data::String(s) => json!(s),
        Data::Float(f) => {
            // 如果是整数形式，返回整数
            if *f == f.floor() && f.is_finite() {
                json!(*f as i64)
            } else {
                json!(f)
            }
        }
        Data::Int(i) => json!(i),
        Data::Bool(b) => json!(b),
        Data::DateTime(dt) => json!(dt.as_f64()),
        Data::DateTimeIso(dt) => json!(dt),
        Data::DurationIso(d) => json!(d),
        Data::Error(e) => json!(format!("[ERR: {}]", e)),
        Data::Empty => Value::Null,
    }
}

/// 读取指定 sheet（或第一个 sheet）的数据，返回 (headers, rows, actual_sheet_name)
fn read_sheet(path: &str, sheet_name: Option<&str>) -> Result<(Vec<String>, Vec<Vec<Value>>, String), String> {
    let p = Path::new(path);
    if !p.exists() {
        return Err(format!("文件不存在: {}", path));
    }

    let mut workbook = open_workbook_auto(path)
        .map_err(|e| format!("无法打开 Excel 文件: {}", e))?;

    let names = workbook.sheet_names().to_vec();
    let actual_name = match sheet_name {
        Some(name) => {
            if !names.contains(&name.to_string()) {
                return Err(format!("Sheet '{}' 不存在，可用 sheet: {:?}", name, names));
            }
            name.to_string()
        }
        None => names.first().ok_or("Excel 文件中没有 sheet")?.clone(),
    };

    let range = workbook.worksheet_range(&actual_name)
        .map_err(|e| format!("读取 sheet '{}' 失败: {}", actual_name, e))?;

    let mut rows_iter = range.rows();

    // 第一行作为表头
    let headers: Vec<String> = match rows_iter.next() {
        Some(row) => row.iter().map(|c| match c {
            Data::String(s) => s.clone(),
            Data::Float(f) => f.to_string(),
            Data::Int(i) => i.to_string(),
            _ => String::new(),
        }).collect(),
        None => return Err("Sheet 是空的，没有表头行".into()),
    };

    // 读取数据行
    let rows: Vec<Vec<Value>> = rows_iter
        .map(|row| {
            let mut vals: Vec<Value> = row.iter().map(cell_to_json).collect();
            // 补齐到表头长度
            while vals.len() < headers.len() {
                vals.push(Value::Null);
            }
            vals.truncate(headers.len());
            vals
        })
        .collect();

    Ok((headers, rows, actual_name))
}

/// 将表头和数据行转换为字典数组
fn rows_to_dicts(headers: &[String], rows: &[Vec<Value>]) -> Vec<Value> {
    rows.iter().map(|row| {
        let mut map = BTreeMap::new();
        for (i, h) in headers.iter().enumerate() {
            let val = row.get(i).cloned().unwrap_or(Value::Null);
            map.insert(h.clone(), val);
        }
        Value::Object(map.into_iter().collect())
    }).collect()
}

/// 将字典数组写入 xlsx 文件
fn write_dicts_to_xlsx(path: &str, sheet_name: &str, data: &[Value], overwrite: bool) -> Result<(), String> {
    if !overwrite && Path::new(path).exists() {
        return Err(format!("文件已存在，且 overwrite=false: {}", path));
    }

    // 确保父目录存在
    if let Some(parent) = Path::new(path).parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("创建目录失败: {}", e))?;
        }
    }

    let mut workbook = Workbook::new();

    // 收集所有列名（保持顺序）
    let mut all_keys: Vec<String> = Vec::new();
    let mut key_set = std::collections::HashSet::new();
    for item in data {
        if let Value::Object(map) = item {
            for key in map.keys() {
                if key_set.insert(key.clone()) {
                    all_keys.push(key.clone());
                }
            }
        }
    }

    let worksheet = workbook.add_worksheet();
    // 设置 sheet 名称
    worksheet.set_name(sheet_name).map_err(|e| format!("设置 sheet 名称失败: {}", e))?;

    // 写入表头
    for (col, key) in all_keys.iter().enumerate() {
        worksheet.write_string(0, col as u16, key)
            .map_err(|e| format!("写入表头失败: {}", e))?;
    }

    // 写入数据
    for (row_idx, item) in data.iter().enumerate() {
        if let Value::Object(map) = item {
            for (col, key) in all_keys.iter().enumerate() {
                let val = map.get(key).unwrap_or(&Value::Null);
                let row = (row_idx + 1) as u32;
                let col = col as u16;
                match val {
                    Value::String(s) => {
                        worksheet.write_string(row, col, s)
                            .map_err(|e| format!("写入字符串失败: {}", e))?;
                    }
                    Value::Number(n) => {
                        if let Some(f) = n.as_f64() {
                            worksheet.write_number(row, col, f)
                                .map_err(|e| format!("写入数字失败: {}", e))?;
                        } else {
                            worksheet.write_string(row, col, &n.to_string())
                                .map_err(|e| format!("写入数字字符串失败: {}", e))?;
                        }
                    }
                    Value::Bool(b) => {
                        worksheet.write_boolean(row, col, *b)
                            .map_err(|e| format!("写入布尔值失败: {}", e))?;
                    }
                    Value::Null => {}
                    _ => {
                        worksheet.write_string(row, col, &val.to_string())
                            .map_err(|e| format!("写入值失败: {}", e))?;
                    }
                }
            }
        }
    }

    workbook.save(path)
        .map_err(|e| format!("保存 Excel 文件失败: {}", e))?;

    Ok(())
}

// ─── 公共函数 ────────────────────────────────────────────

/// 读取 Excel 文件为 JSON 格式
///
/// 返回 JSON 对象，包含 sheet 名称、表头、行数以及所有数据行。
/// sheet_name 为 None 时读取第一个 sheet。
pub(crate) fn read_excel_as_json(path: &str, sheet_name: Option<&str>) -> Result<Value, String> {
    let (headers, rows, actual_name) = read_sheet(path, sheet_name)?;
    let dicts = rows_to_dicts(&headers, &rows);

    Ok(json!({
        "sheet": actual_name,
        "headers": headers,
        "row_count": rows.len(),
        "data": dicts,
    }))
}

/// 对 Excel 数据进行筛选、分组、聚合、去重、分页查询
///
/// - `select`: 逗号分隔的列名，指定返回哪些列
/// - `filter_col` / `filter_val`: 精确匹配过滤
/// - `filter_like`: 模糊匹配（包含）
/// - `filter_in`: IN 列表匹配
/// - `filter_gt` / `filter_lt`: 数值范围过滤
/// - `filter_logic`: "and" 或 "or"，多条件组合方式
/// - `group_by`: 分组列
/// - `agg_col` / `agg_func`: 聚合列和聚合函数（count/sum/avg/min/max）
/// - `limit` / `offset`: 分页
/// - `distinct`: 去重列（返回该列的唯一值）
pub(crate) fn excel_query(
    path: &str,
    sheet: Option<&str>,
    select: Option<&str>,
    filter_col: Option<&str>,
    filter_val: Option<&str>,
    filter_like: Option<&str>,
    filter_in: Option<&[String]>,
    filter_gt: Option<&str>,
    filter_lt: Option<&str>,
    filter_logic: &str,
    group_by: Option<&str>,
    agg_col: Option<&str>,
    agg_func: &str,
    limit: usize,
    offset: usize,
    distinct: Option<&str>,
) -> Result<Value, String> {
    let (headers, rows, actual_name) = read_sheet(path, sheet)?;
    let mut dicts = rows_to_dicts(&headers, &rows);

    // ── 筛选阶段 ──
    let mut filters: Vec<Box<dyn Fn(&Value) -> bool>> = Vec::new();

    if let Some(col) = filter_col {
        // 精确匹配
        if let Some(val) = filter_val {
            let c = col.to_string();
            let v = val.to_string().to_lowercase();
            filters.push(Box::new(move |row| {
                row.get(&c).and_then(|x| x.as_str()).map(|s| s.to_lowercase() == v).unwrap_or(false)
            }));
        }
        // LIKE 匹配
        if let Some(like) = filter_like {
            let c = col.to_string();
            let pat = like.to_string().to_lowercase();
            filters.push(Box::new(move |row| {
                row.get(&c).and_then(|x| x.as_str()).map(|s| s.to_lowercase().contains(&pat)).unwrap_or(false)
            }));
        }
        // IN 匹配
        if let Some(in_vals) = filter_in {
            let c = col.to_string();
            let vals: Vec<String> = in_vals.iter().map(|s| s.to_lowercase()).collect();
            filters.push(Box::new(move |row| {
                row.get(&c).and_then(|x| x.as_str()).map(|s| vals.contains(&s.to_lowercase())).unwrap_or(false)
            }));
        }
        // > 过滤
        if let Some(gt) = filter_gt {
            let c = col.to_string();
            let threshold: f64 = gt.parse().map_err(|_| format!("filter_gt 不是有效数值: {}", gt))?;
            filters.push(Box::new(move |row| {
                row.get(&c).and_then(|x| x.as_f64()).map(|v| v > threshold).unwrap_or(false)
            }));
        }
        // < 过滤
        if let Some(lt) = filter_lt {
            let c = col.to_string();
            let threshold: f64 = lt.parse().map_err(|_| format!("filter_lt 不是有效数值: {}", lt))?;
            filters.push(Box::new(move |row| {
                row.get(&c).and_then(|x| x.as_f64()).map(|v| v < threshold).unwrap_or(false)
            }));
        }
    }

    if !filters.is_empty() {
        let is_and = filter_logic.eq_ignore_ascii_case("and");
        dicts.retain(|row| {
            if is_and {
                filters.iter().all(|f| f(row))
            } else {
                filters.iter().any(|f| f(row))
            }
        });
    }

    // ── DISTINCT ──
    if let Some(dist_col) = distinct {
        let mut seen = std::collections::BTreeSet::new();
        let mut unique_rows = Vec::new();
        for row in &dicts {
            let key = row.get(dist_col).cloned().unwrap_or(Value::Null);
            if seen.insert(key.to_string()) {
                unique_rows.push(row.clone());
            }
        }
        dicts = unique_rows;
    }

    // ── GROUP BY + 聚合 ──
    if let Some(gb_col) = group_by {
        let acc = agg_col.map(|s| s.to_string());
        let mut groups: BTreeMap<String, Vec<Value>> = BTreeMap::new();
        for row in &dicts {
            let key = row.get(gb_col).map(|v| v.to_string()).unwrap_or_default();
            groups.entry(key).or_default().push(row.clone());
        }

        let mut result = Vec::new();
        for (key, group_rows) in &groups {
            let mut entry = BTreeMap::new();
            entry.insert(gb_col.to_string(), json!(key));

            if let Some(ref agg_col_name) = acc {
                let values: Vec<f64> = group_rows.iter()
                    .filter_map(|r| r.get(agg_col_name).and_then(|v| v.as_f64()))
                    .collect();
                let agg_result = match agg_func.to_lowercase().as_str() {
                    "count" => json!(group_rows.len()),
                    "sum" => json!(values.iter().sum::<f64>()),
                    "avg" => {
                        if values.is_empty() {
                            Value::Null
                        } else {
                            json!(values.iter().sum::<f64>() / values.len() as f64)
                        }
                    }
                    "min" => {
                        values.iter().cloned().fold(f64::NAN, f64::min);
                        json!(values.iter().cloned().reduce(f64::min))
                    }
                    "max" => json!(values.iter().cloned().reduce(f64::max)),
                    _ => return Err(format!("不支持的聚合函数: {}", agg_func)),
                };
                entry.insert(format!("{}({})", agg_func, agg_col_name), agg_result);
            } else {
                // 没有 agg_col 时，count 分组行数
                entry.insert("count".to_string(), json!(group_rows.len()));
            }

            result.push(Value::Object(entry.into_iter().collect()));
        }

        return Ok(json!({
            "sheet": actual_name,
            "group_by": gb_col,
            "agg_func": agg_func,
            "row_count": result.len(),
            "data": result,
        }));
    }

    // ── 选择列 ──
    let selected_cols: Option<Vec<String>> = select.map(|s| {
        s.split(',')
            .map(|c| c.trim().to_string())
            .filter(|c| !c.is_empty())
            .collect()
    });

    if let Some(ref cols) = selected_cols {
        for row in &mut dicts {
            if let Value::Object(ref mut map) = row {
                let keys: Vec<String> = map.keys().cloned().collect();
                for k in &keys {
                    if !cols.contains(k) {
                        map.remove(k);
                    }
                }
            }
        }
    }

    // ── 分页 ──
    let total = dicts.len();
    let end = std::cmp::min(offset + limit, dicts.len());
    let page_data: Vec<Value> = if limit == 0 {
        dicts
    } else {
        dicts.drain(offset..end).collect()
    };

    Ok(json!({
        "sheet": actual_name,
        "row_count": page_data.len(),
        "total": total,
        "offset": offset,
        "limit": if limit == 0 { total } else { limit },
        "data": page_data,
    }))
}

/// 各列统计概览
///
/// 对每列统计：非空数量、空值数量、唯一值数量。
/// 对数值列额外统计：最小值、最大值、总和、平均值。
pub(crate) fn excel_summary(path: &str, sheet: Option<&str>) -> Result<Value, String> {
    let (headers, rows, actual_name) = read_sheet(path, sheet)?;
    let dicts = rows_to_dicts(&headers, &rows);

    let mut columns = Vec::new();
    for h in &headers {
        let mut non_empty = 0usize;
        let mut empty = 0usize;
        let mut unique = std::collections::BTreeSet::new();
        let mut numeric_values: Vec<f64> = Vec::new();
        let mut is_numeric = true;

        for row in &dicts {
            match row.get(h) {
                Some(Value::Null) | None => {
                    empty += 1;
                    is_numeric = false;
                }
                Some(val) => {
                    non_empty += 1;
                    unique.insert(val.to_string());
                    if is_numeric {
                        if let Some(f) = val.as_f64() {
                            numeric_values.push(f);
                        } else {
                            is_numeric = false;
                        }
                    }
                }
            }
        }

        let mut col_info = serde_json::Map::new();
        col_info.insert("column".to_string(), json!(h));
        col_info.insert("non_empty".to_string(), json!(non_empty));
        col_info.insert("empty".to_string(), json!(empty));
        col_info.insert("unique".to_string(), json!(unique.len()));

        if is_numeric && !numeric_values.is_empty() {
            let total: f64 = numeric_values.iter().sum();
            let avg = total / numeric_values.len() as f64;
            let min = numeric_values.iter().cloned().reduce(f64::min).unwrap_or(0.0);
            let max = numeric_values.iter().cloned().reduce(f64::max).unwrap_or(0.0);
            col_info.insert("min".to_string(), json!(min));
            col_info.insert("max".to_string(), json!(max));
            col_info.insert("sum".to_string(), json!(total));
            col_info.insert("avg".to_string(), json!(avg));
            col_info.insert("type".to_string(), json!("numeric"));
        } else {
            col_info.insert("type".to_string(), json!("text"));
        }

        columns.push(Value::Object(col_info));
    }

    Ok(json!({
        "sheet": actual_name,
        "row_count": rows.len(),
        "col_count": headers.len(),
        "columns": columns,
    }))
}

/// 正则列变换
///
/// 对 source_col 列应用正则表达式 regex，提取匹配内容写入 target_col。
/// 如果 target_col 不存在则新建，limit 限制处理行数。
pub(crate) fn excel_transform(
    path: &str,
    source_col: &str,
    target_col: &str,
    regex: &str,
    sheet: Option<&str>,
    limit: usize,
) -> Result<Value, String> {
    let re = Regex::new(regex).map_err(|e| format!("正则表达式无效: {}", e))?;
    let (headers, rows, actual_name) = read_sheet(path, sheet)?;
    let mut dicts = rows_to_dicts(&headers, &rows);

    // 确保目标列存在
    let all_headers: Vec<String> = {
        let mut set: std::collections::BTreeSet<String> = headers.iter().cloned().collect();
        set.insert(target_col.to_string());
        set.into_iter().collect()
    };

    let max_rows = if limit == 0 { dicts.len() } else { std::cmp::min(limit, dicts.len()) };
    let mut transformed = 0usize;

    for row in dicts.iter_mut().take(max_rows) {
        if let Some(src_val) = row.get(source_col) {
            let src_str = match src_val {
                Value::String(s) => s.clone(),
                Value::Number(n) => n.to_string(),
                _ => continue,
            };

            let extracted: Vec<String> = re.captures(&src_str)
                .map(|caps| {
                    // 如果有捕获组，用第一个捕获组；否则用整个匹配
                    if caps.len() > 1 {
                        (1..caps.len()).map(|i| caps.get(i).map(|m| m.as_str().to_string()).unwrap_or_default()).collect()
                    } else {
                        vec![caps.get(0).map(|m| m.as_str().to_string()).unwrap_or_default()]
                    }
                })
                .unwrap_or_default();

            let result = if extracted.len() == 1 {
                json!(extracted[0])
            } else {
                json!(extracted)
            };

            if let Value::Object(ref mut map) = row {
                map.insert(target_col.to_string(), result);
            }
            transformed += 1;
        }
    }

    let result_dicts: Vec<Value> = dicts.iter().map(|row| {
        let mut map = BTreeMap::new();
        for h in &all_headers {
            let val = row.get(h).cloned().unwrap_or(Value::Null);
            map.insert(h.clone(), val);
        }
        Value::Object(map.into_iter().collect())
    }).collect();

    Ok(json!({
        "sheet": actual_name,
        "source_col": source_col,
        "target_col": target_col,
        "regex": regex,
        "transformed": transformed,
        "row_count": result_dicts.len(),
        "data": result_dicts,
    }))
}

/// 查找重复行
///
/// `key_cols`: 逗号分隔的列名，作为判断重复的键
/// `action`: "keep_first" 保留首次出现、"keep_last" 保留最后出现、
///           "show_all" 显示所有行（标记是否重复）、"show_duplicates_only" 仅显示重复行
pub(crate) fn excel_dedup(
    path: &str,
    key_cols: &str,
    action: &str,
    sheet: Option<&str>,
    limit: usize,
) -> Result<Value, String> {
    let keys: Vec<String> = key_cols.split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    if keys.is_empty() {
        return Err("key_cols 不能为空".into());
    }

    let (headers, rows, actual_name) = read_sheet(path, sheet)?;
    let dicts = rows_to_dicts(&headers, &rows);

    // 构建键 -> 行索引列表
    let mut key_map: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for (idx, row) in dicts.iter().enumerate() {
        let key_parts: Vec<String> = keys.iter()
            .map(|k| row.get(k).map(|v| v.to_string()).unwrap_or_default())
            .collect();
        let composite_key = key_parts.join("|");
        key_map.entry(composite_key).or_default().push(idx);
    }

    match action {
        "keep_first" | "keep_last" => {
            let keep_last = action == "keep_last";
            let mut result = Vec::new();
            for indices in key_map.values() {
                let keep_idx = if keep_last { indices[indices.len() - 1] } else { indices[0] };
                result.push(dicts[keep_idx].clone());
            }

            let max_rows = if limit == 0 { result.len() } else { std::cmp::min(limit, result.len()) };
            result.truncate(max_rows);

            Ok(json!({
                "sheet": actual_name,
                "key_cols": key_cols,
                "action": action,
                "original_count": dicts.len(),
                "deduped_count": result.len(),
                "data": result,
            }))
        }
        "show_all" => {
            let mut duplicates_set = std::collections::BTreeSet::new();
            for indices in key_map.values() {
                if indices.len() > 1 {
                    for &i in indices {
                        duplicates_set.insert(i);
                    }
                }
            }

            let max_rows = if limit == 0 { dicts.len() } else { std::cmp::min(limit, dicts.len()) };
            let result: Vec<Value> = dicts.iter().enumerate().take(max_rows).map(|(idx, row)| {
                let mut map = BTreeMap::new();
                if let Value::Object(ref m) = row {
                    for (k, v) in m {
                        map.insert(k.clone(), v.clone());
                    }
                }
                map.insert("_is_duplicate".to_string(), json!(duplicates_set.contains(&idx)));
                map.insert("_row_index".to_string(), json!(idx));
                Value::Object(map.into_iter().collect())
            }).collect();

            Ok(json!({
                "sheet": actual_name,
                "key_cols": key_cols,
                "action": action,
                "original_count": dicts.len(),
                "duplicate_count": duplicates_set.len(),
                "data": result,
            }))
        }
        "show_duplicates_only" => {
            let mut dupe_indices = std::collections::BTreeSet::new();
            for indices in key_map.values() {
                if indices.len() > 1 {
                    for &i in indices {
                        dupe_indices.insert(i);
                    }
                }
            }

            let mut dupe_rows: Vec<Value> = dupe_indices.iter().map(|&i| dicts[i].clone()).collect();
            let max_rows = if limit == 0 { dupe_rows.len() } else { std::cmp::min(limit, dupe_rows.len()) };
            dupe_rows.truncate(max_rows);

            Ok(json!({
                "sheet": actual_name,
                "key_cols": key_cols,
                "action": action,
                "original_count": dicts.len(),
                "duplicate_count": dupe_rows.len(),
                "data": dupe_rows,
            }))
        }
        _ => Err(format!("不支持的 action: {}（支持: keep_first, keep_last, show_all, show_duplicates_only）", action)),
    }
}

/// 两表关联（JOIN）
///
/// `left` / `right`: 文件路径
/// `left_key` / `right_key`: 关联键列名
/// `left_key_extract` / `right_key_extract`: 可选，从键值中提取匹配部分的正则
/// `join_type`: "inner", "left", "right", "outer"
/// `select`: 逗号分隔的列名，支持 "left." / "right." 前缀
/// `limit`: 最大返回行数（0 表示不限制）
pub(crate) fn excel_join(
    left: &str,
    left_key: &str,
    right: &str,
    right_key: &str,
    left_sheet: Option<&str>,
    right_sheet: Option<&str>,
    left_key_extract: Option<&str>,
    right_key_extract: Option<&str>,
    join_type: &str,
    select: Option<&str>,
    limit: usize,
) -> Result<Value, String> {
    // 读取左右表
    let (l_headers, l_rows, l_sheet) = read_sheet(left, left_sheet)?;
    let (r_headers, r_rows, r_sheet) = read_sheet(right, right_sheet)?;
    let l_dicts = rows_to_dicts(&l_headers, &l_rows);
    let r_dicts = rows_to_dicts(&r_headers, &r_rows);

    // 编译 key extract 正则
    let l_extract_re = left_key_extract.map(|s| Regex::new(s).map_err(|e| format!("left_key_extract 无效: {}", e))).transpose()?;
    let r_extract_re = right_key_extract.map(|s| Regex::new(s).map_err(|e| format!("right_key_extract 无效: {}", e))).transpose()?;

    // 提取 key 的函数
    let extract_key = |row: &Value, key_col: &str, extract_re: &Option<Regex>| -> String {
        let raw = row.get(key_col).map(|v| v.to_string()).unwrap_or_default();
        if let Some(ref re) = extract_re {
            re.captures(&raw)
                .and_then(|caps| caps.get(1).or_else(|| caps.get(0)))
                .map(|m| m.as_str().to_string())
                .unwrap_or(raw)
        } else {
            raw
        }
    };

    // 构建右表索引（存储索引和引用）
    let mut r_index: BTreeMap<String, Vec<(usize, &Value)>> = BTreeMap::new();
    for (idx, r_row) in r_dicts.iter().enumerate() {
        let key = extract_key(r_row, right_key, &r_extract_re);
        r_index.entry(key).or_default().push((idx, r_row));
    }

    // 跟踪已匹配的右表行索引（用于 outer join）
    let mut r_matched: std::collections::BTreeSet<usize> = std::collections::BTreeSet::new();

    // 解析 select
    let select_cols: Option<Vec<String>> = select.map(|s| {
        s.split(',').map(|c| c.trim().to_string()).filter(|c| !c.is_empty()).collect()
    });

    // 确定输出列
    let has_left_prefix = |name: &str| name.starts_with("left.");
    let has_right_prefix = |name: &str| name.starts_with("right.");

    let l_cols: Vec<String> = if let Some(ref cols) = select_cols {
        cols.iter().filter(|c| !has_right_prefix(c)).cloned().collect()
    } else {
        l_headers.iter().map(|h| h.clone()).collect()
    };

    let r_cols: Vec<String> = if let Some(ref cols) = select_cols {
        cols.iter().filter(|c| !has_left_prefix(c)).cloned().collect()
    } else {
        r_headers.iter().map(|h| h.clone()).collect()
    };

    let l_output_cols: Vec<String> = l_cols.iter().map(|c| {
        if has_left_prefix(c) { c.strip_prefix("left.").unwrap_or(c).to_string() } else { c.clone() }
    }).collect();

    let r_output_cols: Vec<String> = r_cols.iter().map(|c| {
        if has_right_prefix(c) { c.strip_prefix("right.").unwrap_or(c).to_string() } else { c.clone() }
    }).collect();

    // 处理列名冲突
    let mut output_col_names: Vec<String> = Vec::new();
    let mut lr_name_set: std::collections::HashSet<String> = std::collections::HashSet::new();

    for c in &l_output_cols {
        if lr_name_set.contains(c) {
            output_col_names.push(format!("left.{}", c));
        } else {
            lr_name_set.insert(c.clone());
            output_col_names.push(c.clone());
        }
    }

    for c in &r_output_cols {
        if lr_name_set.contains(c) {
            output_col_names.push(format!("right.{}", c));
        } else {
            lr_name_set.insert(c.clone());
            output_col_names.push(c.clone());
        }
    }

    // 执行 JOIN
    let mut result: Vec<Value> = Vec::new();

    for l_row in &l_dicts {
        let key = extract_key(l_row, left_key, &l_extract_re);

        let r_matches = r_index.get(&key);

        match join_type {
            "inner" => {
                if let Some(rows) = r_matches {
                    for &(_, r_row) in rows {
                        let mut map = BTreeMap::new();
                        for (i, col) in l_output_cols.iter().enumerate() {
                            let val = l_row.get(col).cloned().unwrap_or(Value::Null);
                            map.insert(output_col_names[i].clone(), val);
                        }
                        for (i, col) in r_output_cols.iter().enumerate() {
                            let val = r_row.get(col).cloned().unwrap_or(Value::Null);
                            map.insert(output_col_names[l_output_cols.len() + i].clone(), val);
                        }
                        result.push(Value::Object(map.into_iter().collect()));
                    }
                }
            }
            "left" => {
                if let Some(rows) = r_matches {
                    for &(_, r_row) in rows {
                        let mut map = BTreeMap::new();
                        for (i, col) in l_output_cols.iter().enumerate() {
                            let val = l_row.get(col).cloned().unwrap_or(Value::Null);
                            map.insert(output_col_names[i].clone(), val);
                        }
                        for (i, col) in r_output_cols.iter().enumerate() {
                            let val = r_row.get(col).cloned().unwrap_or(Value::Null);
                            map.insert(output_col_names[l_output_cols.len() + i].clone(), val);
                        }
                        result.push(Value::Object(map.into_iter().collect()));
                    }
                } else {
                    // 左表保留，右表补 NULL
                    let mut map = BTreeMap::new();
                    for (i, col) in l_output_cols.iter().enumerate() {
                        let val = l_row.get(col).cloned().unwrap_or(Value::Null);
                        map.insert(output_col_names[i].clone(), val);
                    }
                    for i in 0..r_output_cols.len() {
                        map.insert(output_col_names[l_output_cols.len() + i].clone(), Value::Null);
                    }
                    result.push(Value::Object(map.into_iter().collect()));
                }
            }
            "right" => {
                if let Some(rows) = r_matches {
                    for &(_, r_row) in rows {
                        let mut map = BTreeMap::new();
                        for (i, col) in l_output_cols.iter().enumerate() {
                            let val = l_row.get(col).cloned().unwrap_or(Value::Null);
                            map.insert(output_col_names[i].clone(), val);
                        }
                        for (i, col) in r_output_cols.iter().enumerate() {
                            let val = r_row.get(col).cloned().unwrap_or(Value::Null);
                            map.insert(output_col_names[l_output_cols.len() + i].clone(), val);
                        }
                        result.push(Value::Object(map.into_iter().collect()));
                    }
                }
                // 不保留未匹配的左表行
            }
            "outer" => {
                if let Some(rows) = r_matches {
                    for &(r_idx, r_row) in rows {
                        r_matched.insert(r_idx);
                        let mut map = BTreeMap::new();
                        for (i, col) in l_output_cols.iter().enumerate() {
                            let val = l_row.get(col).cloned().unwrap_or(Value::Null);
                            map.insert(output_col_names[i].clone(), val);
                        }
                        for (i, col) in r_output_cols.iter().enumerate() {
                            let val = r_row.get(col).cloned().unwrap_or(Value::Null);
                            map.insert(output_col_names[l_output_cols.len() + i].clone(), val);
                        }
                        result.push(Value::Object(map.into_iter().collect()));
                    }
                } else {
                    // 左表保留，右表补 NULL
                    let mut map = BTreeMap::new();
                    for (i, col) in l_output_cols.iter().enumerate() {
                        let val = l_row.get(col).cloned().unwrap_or(Value::Null);
                        map.insert(output_col_names[i].clone(), val);
                    }
                    for i in 0..r_output_cols.len() {
                        map.insert(output_col_names[l_output_cols.len() + i].clone(), Value::Null);
                    }
                    result.push(Value::Object(map.into_iter().collect()));
                }
            }
            _ => return Err(format!("不支持的 join_type: {}（支持: inner, left, right, outer）", join_type)),
        }

        // 限制结果行数
        if limit > 0 && result.len() >= limit {
            break;
        }
    }

    // outer join: 补充右表中未匹配的行
    if join_type == "outer" {
        for (r_idx, r_row) in r_dicts.iter().enumerate() {
            if !r_matched.contains(&r_idx) {
                let mut map = BTreeMap::new();
                for (i, _col) in l_output_cols.iter().enumerate() {
                    map.insert(output_col_names[i].clone(), Value::Null);
                }
                for (i, col) in r_output_cols.iter().enumerate() {
                    let val = r_row.get(col).cloned().unwrap_or(Value::Null);
                    map.insert(output_col_names[l_output_cols.len() + i].clone(), val);
                }
                result.push(Value::Object(map.into_iter().collect()));
            }
            if limit > 0 && result.len() >= limit {
                break;
            }
        }
    }

    // 右表右连接：保留右表中即使左表无匹配的行
    if join_type == "right" {
        let l_key_set: std::collections::BTreeSet<String> = l_dicts.iter()
            .map(|r| extract_key(r, left_key, &l_extract_re))
            .collect();

        for r_row in &r_dicts {
            let key = extract_key(r_row, right_key, &r_extract_re);
            if !l_key_set.contains(&key) {
                let mut map = BTreeMap::new();
                for (i, _col) in l_output_cols.iter().enumerate() {
                    map.insert(output_col_names[i].clone(), Value::Null);
                }
                for (i, col) in r_output_cols.iter().enumerate() {
                    let val = r_row.get(col).cloned().unwrap_or(Value::Null);
                    map.insert(output_col_names[l_output_cols.len() + i].clone(), val);
                }
                result.push(Value::Object(map.into_iter().collect()));
            }
            if limit > 0 && result.len() >= limit {
                break;
            }
        }
    }

    let max_rows = if limit == 0 { result.len() } else { std::cmp::min(limit, result.len() + 1000) };
    result.truncate(max_rows);

    Ok(json!({
        "left_sheet": l_sheet,
        "right_sheet": r_sheet,
        "left_key": left_key,
        "right_key": right_key,
        "join_type": join_type,
        "row_count": result.len(),
        "columns": output_col_names,
        "data": result,
    }))
}

/// 纵向合并多表（UNION）
///
/// 读取多个 Excel 文件，将所有行合并输出到新文件。
/// 所有文件应具有相同的列结构。以第一个文件的表头为准。
pub(crate) fn excel_union(files: &[String], output: &str, sheet: &str) -> Result<Value, String> {
    if files.is_empty() {
        return Err("文件列表为空".into());
    }

    // 读取第一个文件确定列结构
    let (base_headers, all_rows, _) = read_sheet(&files[0], None)?;
    let mut all_dicts = rows_to_dicts(&base_headers, &all_rows);

    // 读取后续文件
    for fpath in &files[1..] {
        let (headers, rows, _) = read_sheet(fpath, None)?;
        let dicts = rows_to_dicts(&headers, &rows);

        // 将行转换为第一个文件的列结构（只保留匹配的列）
        for row in &dicts {
            let mut mapped = BTreeMap::new();
            for h in &base_headers {
                let val = row.get(h).cloned().unwrap_or(Value::Null);
                mapped.insert(h.clone(), val);
            }
            all_dicts.push(Value::Object(mapped.into_iter().collect()));
        }

        // 将新增的列也追加到已有行（如果有新列）
        for h in &headers {
            if !base_headers.contains(h) {
                for existing_row in &mut all_dicts {
                    if let Value::Object(ref mut map) = existing_row {
                        if !map.contains_key(h) {
                            map.insert(h.clone(), Value::Null);
                        }
                    }
                }
            }
        }
    }

    // 写入输出文件
    write_dicts_to_xlsx(output, sheet, &all_dicts, true)?;

    Ok(json!({
        "files_merged": files.len(),
        "output": output,
        "sheet": sheet,
        "row_count": all_dicts.len(),
        "columns": base_headers,
        "message": format!("成功合并 {} 个文件到 {}", files.len(), output),
    }))
}

/// JSON → xlsx 写入
///
/// `data_json`: JSON 字符串，应为对象数组 `[{col1: val1, col2: val2}, ...]`
/// `overwrite`: 是否覆盖已存在的文件
pub(crate) fn json_to_xlsx(path: &str, sheet: &str, data_json: &str, overwrite: bool) -> Result<Value, String> {
    let parsed: Value = serde_json::from_str(data_json)
        .map_err(|e| format!("JSON 解析失败: {}", e))?;

    let data: Vec<Value> = match &parsed {
        Value::Array(arr) => arr.clone(),
        _ => return Err("data_json 应为 JSON 数组".into()),
    };

    write_dicts_to_xlsx(path, sheet, &data, overwrite)?;

    Ok(json!({
        "path": path,
        "sheet": sheet,
        "row_count": data.len(),
        "message": format!("成功写入 {} 行数据到 {}", data.len(), path),
    }))
}

/// 多步骤处理流水线
///
/// `pipeline_json`: JSON 字符串，定义处理步骤数组。
///
/// 支持的步骤类型:
/// - `read`: 读取 Excel => `{"type": "read", "path": "...", "sheet": "..."}`
/// - `filter`: 过滤行 => `{"type": "filter", "column": "...", "operator": "eq|ne|gt|lt|gte|lte|contains", "value": "..."}`
/// - `sort`: 排序 => `{"type": "sort", "column": "...", "order": "asc|desc"}`
/// - `select`: 选择列 => `{"type": "select", "columns": ["col1", "col2"]}`
/// - `limit`: 限制行数 => `{"type": "limit", "limit": 10}`
/// - `transform`: 正则变换 => `{"type": "transform", "source": "...", "target": "...", "regex": "..."}`
/// - `dedup`: 去重 => `{"type": "dedup", "keys": ["col1"], "action": "keep_first"}`
/// - `group`: 分组聚合 => `{"type": "group", "by": "...", "agg_col": "...", "agg_func": "count|sum|avg|min|max"}`
/// - `distinct`: 去重列值 => `{"type": "distinct", "column": "..."}`
/// - `write`: 写入文件 => `{"type": "write", "path": "...", "sheet": "..."}`
///
/// 流水线执行完成后返回最终数据。
pub(crate) fn data_pipeline(pipeline_json: &str, limit: usize) -> Result<Value, String> {
    let steps: Vec<Value> = serde_json::from_str(pipeline_json)
        .map_err(|e| format!("pipeline_json 解析失败: {}", e))?;

    if steps.is_empty() {
        return Err("流水线步骤为空".into());
    }

    // 当前数据：Vec<Value> 代表行字典列表
    let mut current_data: Option<Vec<Value>> = None;
    let mut current_headers: Option<Vec<String>> = None;
    let mut steps_executed = 0usize;

    for (step_idx, step) in steps.iter().enumerate() {
        let step_type = step.get("type")
            .and_then(|v| v.as_str())
            .ok_or_else(|| format!("步骤 {} 缺少 type 字段", step_idx))?;

        match step_type {
            "read" => {
                let path = step.get("path")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| format!("read 步骤缺少 path 字段"))?;
                let sheet = step.get("sheet").and_then(|v| v.as_str());

                let (headers, rows, _) = read_sheet(path, sheet)?;
                current_headers = Some(headers.clone());
                current_data = Some(rows_to_dicts(&headers, &rows));
                steps_executed += 1;
            }
            "filter" => {
                let data = current_data.as_mut()
                    .ok_or_else(|| format!("步骤 {}: filter 前必须先 read", step_idx))?;

                let column = step.get("column")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| format!("filter 步骤缺少 column 字段"))?
                    .to_string();

                let operator = step.get("operator")
                    .and_then(|v| v.as_str())
                    .unwrap_or("eq");

                let value = step.get("value")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| format!("filter 步骤缺少 value 字段"))?
                    .to_string();

                data.retain(|row| {
                    let cell_val = row.get(&column).map(|v| v.to_string()).unwrap_or_default();
                    let cell_lower = cell_val.to_lowercase();
                    let val_lower = value.to_lowercase();

                    match operator {
                        "eq" => cell_lower == val_lower,
                        "ne" => cell_lower != val_lower,
                        "gt" => {
                            let a = cell_val.parse::<f64>().unwrap_or(f64::NAN);
                            let b = value.parse::<f64>().unwrap_or(f64::NAN);
                            a > b
                        }
                        "lt" => {
                            let a = cell_val.parse::<f64>().unwrap_or(f64::NAN);
                            let b = value.parse::<f64>().unwrap_or(f64::NAN);
                            a < b
                        }
                        "gte" => {
                            let a = cell_val.parse::<f64>().unwrap_or(f64::NAN);
                            let b = value.parse::<f64>().unwrap_or(f64::NAN);
                            a >= b
                        }
                        "lte" => {
                            let a = cell_val.parse::<f64>().unwrap_or(f64::NAN);
                            let b = value.parse::<f64>().unwrap_or(f64::NAN);
                            a <= b
                        }
                        "contains" => cell_lower.contains(&val_lower),
                        _ => false,
                    }
                });
                steps_executed += 1;
            }
            "sort" => {
                let data = current_data.as_mut()
                    .ok_or_else(|| format!("步骤 {}: sort 前必须先 read", step_idx))?;

                let column = step.get("column")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| format!("sort 步骤缺少 column 字段"))?
                    .to_string();

                let order = step.get("order")
                    .and_then(|v| v.as_str())
                    .unwrap_or("asc");

                let descending = order.eq_ignore_ascii_case("desc");

                data.sort_by(|a, b| {
                    let va = a.get(&column).map(|v| v.to_string()).unwrap_or_default();
                    let vb = b.get(&column).map(|v| v.to_string()).unwrap_or_default();

                    // 尝试数值比较
                    let na = va.parse::<f64>();
                    let nb = vb.parse::<f64>();

                    let cmp = if let (Ok(na), Ok(nb)) = (na, nb) {
                        na.partial_cmp(&nb).unwrap_or(std::cmp::Ordering::Equal)
                    } else {
                        va.to_lowercase().cmp(&vb.to_lowercase())
                    };

                    if descending { cmp.reverse() } else { cmp }
                });
                steps_executed += 1;
            }
            "select" => {
                let data = current_data.as_mut()
                    .ok_or_else(|| format!("步骤 {}: select 前必须先 read", step_idx))?;

                let cols: Vec<String> = step.get("columns")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter().filter_map(|v| v.as_str()).map(|s| s.to_string()).collect()
                    })
                    .ok_or_else(|| format!("select 步骤缺少 columns 数组"))?;

                for row in data.iter_mut() {
                    if let Value::Object(ref mut map) = row {
                        let keys: Vec<String> = map.keys().cloned().collect();
                        for k in &keys {
                            if !cols.contains(k) {
                                map.remove(k);
                            }
                        }
                    }
                }

                if let Some(ref mut headers) = current_headers {
                    headers.retain(|h| cols.contains(h));
                }
                steps_executed += 1;
            }
            "limit" => {
                let data = current_data.as_mut()
                    .ok_or_else(|| format!("步骤 {}: limit 前必须先 read", step_idx))?;

                let n = step.get("limit")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(10) as usize;

                data.truncate(n);
                steps_executed += 1;
            }
            "transform" => {
                let data = current_data.as_mut()
                    .ok_or_else(|| format!("步骤 {}: transform 前必须先 read", step_idx))?;

                let source = step.get("source")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| format!("transform 步骤缺少 source 字段"))?;

                let target = step.get("target")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| format!("transform 步骤缺少 target 字段"))?;

                let regex_str = step.get("regex")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| format!("transform 步骤缺少 regex 字段"))?;

                let re = Regex::new(regex_str)
                    .map_err(|e| format!("正则表达式无效: {}", e))?;

                // 确保 target 列在 headers 中
                if let Some(ref mut headers) = current_headers {
                    if !headers.contains(&target.to_string()) {
                        headers.push(target.to_string());
                    }
                }

                for row in data.iter_mut() {
                    let src_val = row.get(source).map(|v| v.to_string()).unwrap_or_default();
                    let result = re.captures(&src_val)
                        .and_then(|caps| caps.get(1).or_else(|| caps.get(0)))
                        .map(|m| json!(m.as_str()))
                        .unwrap_or(Value::Null);

                    if let Value::Object(ref mut map) = row {
                        map.insert(target.to_string(), result);
                    }
                }
                steps_executed += 1;
            }
            "dedup" => {
                let data = current_data.as_mut()
                    .ok_or_else(|| format!("步骤 {}: dedup 前必须先 read", step_idx))?;

                let keys: Vec<String> = step.get("keys")
                    .and_then(|v| v.as_array())
                    .map(|arr| arr.iter().filter_map(|v| v.as_str()).map(|s| s.to_string()).collect())
                    .ok_or_else(|| format!("dedup 步骤缺少 keys 数组"))?;

                let action = step.get("action")
                    .and_then(|v| v.as_str())
                    .unwrap_or("keep_first");

                let mut seen = std::collections::BTreeSet::new();
                let mut deduped = Vec::new();

                match action {
                    "keep_first" => {
                        for row in data.drain(..) {
                            let key_parts: Vec<String> = keys.iter()
                                .map(|k| row.get(k).map(|v| v.to_string()).unwrap_or_default())
                                .collect();
                            let composite = key_parts.join("|");
                            if seen.insert(composite) {
                                deduped.push(row);
                            }
                        }
                    }
                    "keep_last" => {
                        // 先全部保留，然后逆序去重
                        let mut reversed: Vec<Value> = data.drain(..).rev().collect();
                        for row in reversed.drain(..) {
                            let key_parts: Vec<String> = keys.iter()
                                .map(|k| row.get(k).map(|v| v.to_string()).unwrap_or_default())
                                .collect();
                            let composite = key_parts.join("|");
                            if seen.insert(composite) {
                                deduped.push(row);
                            }
                        }
                        deduped.reverse();
                    }
                    _ => return Err(format!("不支持的 dedup action: {}", action)),
                }

                *data = deduped;
                steps_executed += 1;
            }
            "group" => {
                let data = current_data.as_mut()
                    .ok_or_else(|| format!("步骤 {}: group 前必须先 read", step_idx))?;

                let gb_col = step.get("by")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| format!("group 步骤缺少 by 字段"))?
                    .to_string();

                let agg_col = step.get("agg_col").and_then(|v| v.as_str());
                let agg_func = step.get("agg_func")
                    .and_then(|v| v.as_str())
                    .unwrap_or("count");

                let mut groups: BTreeMap<String, Vec<Value>> = BTreeMap::new();
                for row in data.drain(..) {
                    let key = row.get(&gb_col).map(|v| v.to_string()).unwrap_or_default();
                    groups.entry(key).or_default().push(row);
                }

                let mut result = Vec::new();
                for (key, group_rows) in &groups {
                    let mut entry = BTreeMap::new();
                    entry.insert(gb_col.clone(), json!(key));

                    if let Some(agg) = agg_col {
                        let values: Vec<f64> = group_rows.iter()
                            .filter_map(|r| r.get(agg).and_then(|v| v.as_f64()))
                            .collect();

                        let agg_result = match agg_func {
                            "count" => json!(group_rows.len()),
                            "sum" => json!(values.iter().sum::<f64>()),
                            "avg" => {
                                if values.is_empty() {
                                    Value::Null
                                } else {
                                    json!(values.iter().sum::<f64>() / values.len() as f64)
                                }
                            }
                            "min" => json!(values.iter().cloned().reduce(f64::min)),
                            "max" => json!(values.iter().cloned().reduce(f64::max)),
                            _ => Value::Null,
                        };
                        entry.insert(format!("{}({})", agg_func, agg), agg_result);
                    } else {
                        entry.insert("count".to_string(), json!(group_rows.len()));
                    }

                    result.push(Value::Object(entry.into_iter().collect()));
                }

                *data = result;
                if let Some(ref mut headers) = current_headers {
                    if let Some(agg) = agg_col {
                        *headers = vec![gb_col.clone(), format!("{}({})", agg_func, agg)];
                    } else {
                        *headers = vec![gb_col.clone(), "count".to_string()];
                    }
                }
                steps_executed += 1;
            }
            "distinct" => {
                let data = current_data.as_mut()
                    .ok_or_else(|| format!("步骤 {}: distinct 前必须先 read", step_idx))?;

                let column = step.get("column")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| format!("distinct 步骤缺少 column 字段"))?
                    .to_string();

                let mut seen = std::collections::BTreeSet::new();
                let mut result = Vec::new();
                for row in data.drain(..) {
                    let val = row.get(&column).cloned().unwrap_or(Value::Null);
                    if seen.insert(val.to_string()) {
                        let mut map = BTreeMap::new();
                        map.insert(column.clone(), val);
                        result.push(Value::Object(map.into_iter().collect()));
                    }
                }
                *data = result;

                if let Some(ref mut headers) = current_headers {
                    *headers = vec![column];
                }
                steps_executed += 1;
            }
            "write" => {
                let data = current_data.as_ref()
                    .ok_or_else(|| format!("步骤 {}: write 前必须先 read", step_idx))?;

                let path = step.get("path")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| format!("write 步骤缺少 path 字段"))?;

                let sheet_name = step.get("sheet")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Sheet1");

                write_dicts_to_xlsx(path, sheet_name, data, true)?;
                steps_executed += 1;
            }
            _ => return Err(format!("不支持的步骤类型: {}", step_type)),
        }

        // 应用全局 limit 限制，防止内存溢出
        if limit > 0 {
            if let Some(ref mut data) = current_data {
                if data.len() > limit * 2 {
                    data.truncate(limit * 2);
                }
            }
        }
    }

    let final_data = current_data.unwrap_or_default();

    Ok(json!({
        "steps_executed": steps_executed,
        "row_count": final_data.len(),
        "data": final_data,
        "headers": current_headers.unwrap_or_default(),
    }))
}
