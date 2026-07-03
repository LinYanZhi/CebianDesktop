use std::io::{Cursor, Write};
use std::path::Path;
use zip::{CompressionMethod, ZipWriter};

/// 将文本内容生成为 .docx 文件
pub(crate) fn export_to_docx(content: &str, destination: &str, title: Option<&str>) -> Result<String, String> {
    let dest = Path::new(destination);
    // 自动补 .docx 后缀
    let dest_str = if dest.extension().map_or(true, |e| e != "docx") {
        format!("{}.docx", destination.trim_end_matches('.'))
    } else {
        destination.to_string()
    };

    // 解析内容为段落块
    let blocks = parse_markdown(content);

    // 生成 document.xml
    let document_xml = build_document_xml(&blocks, title);

    // 生成各种需要的 XML
    let content_types_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>"#;

    let rels_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"#;

    let doc_rels_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>"#;

    // 生成 styles.xml（支持中文字体 + 正文/标题样式）
    let styles_xml = build_styles_xml();

    // 打包成 ZIP（即 .docx）
    let buf = Cursor::new(Vec::new());
    let mut zip = ZipWriter::new(buf);

    let options: zip::write::FileOptions<'_, ()> = zip::write::FileOptions::default()
        .compression_method(CompressionMethod::Deflated);

    zip.start_file("[Content_Types].xml", options)
        .map_err(|e| format!("ZIP 写入失败: {}", e))?;
    zip.write_all(content_types_xml.as_bytes())
        .map_err(|e| format!("ZIP 写入失败: {}", e))?;

    zip.start_file("_rels/.rels", options)
        .map_err(|e| format!("ZIP 写入失败: {}", e))?;
    zip.write_all(rels_xml.as_bytes())
        .map_err(|e| format!("ZIP 写入失败: {}", e))?;

    zip.start_file("word/_rels/document.xml.rels", options)
        .map_err(|e| format!("ZIP 写入失败: {}", e))?;
    zip.write_all(doc_rels_xml.as_bytes())
        .map_err(|e| format!("ZIP 写入失败: {}", e))?;

    zip.start_file("word/document.xml", options)
        .map_err(|e| format!("ZIP 写入失败: {}", e))?;
    zip.write_all(document_xml.as_bytes())
        .map_err(|e| format!("ZIP 写入失败: {}", e))?;

    zip.start_file("word/styles.xml", options)
        .map_err(|e| format!("ZIP 写入失败: {}", e))?;
    zip.write_all(styles_xml.as_bytes())
        .map_err(|e| format!("ZIP 写入失败: {}", e))?;

    let cursor = zip.finish()
        .map_err(|e| format!("ZIP 打包失败: {}", e))?;
    let bytes = cursor.into_inner();

    std::fs::write(&dest_str, &bytes)
        .map_err(|e| format!("写入文件失败: {}", e))?;

    Ok(format!("已导出到: {}", dest_str))
}

/// 一个段落/块
struct Block {
    style: BlockStyle,
    lines: Vec<Line>,
}

enum BlockStyle {
    Normal,
    Heading1,
    Heading2,
    Heading3,
    ListItem,
    Empty,
}

struct Line {
    text: String,
    bold: bool,
    italic: bool,
}

/// 简单解析 Markdown 为块结构
fn parse_markdown(text: &str) -> Vec<Block> {
    let mut blocks = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            blocks.push(Block { style: BlockStyle::Empty, lines: Vec::new() });
            continue;
        }
        let (style, content) = if trimmed.starts_with("### ") {
            (BlockStyle::Heading3, &trimmed[4..])
        } else if trimmed.starts_with("## ") {
            (BlockStyle::Heading2, &trimmed[3..])
        } else if trimmed.starts_with("# ") {
            (BlockStyle::Heading1, &trimmed[2..])
        } else if trimmed.starts_with("- ") || trimmed.starts_with("* ") {
            (BlockStyle::ListItem, &trimmed[2..])
        } else {
            (BlockStyle::Normal, trimmed)
        };

        let lines = parse_inline_formatting(content);
        blocks.push(Block { style, lines });
    }
    blocks
}

/// 解析行内加粗 **text** 和斜体 *text*
fn parse_inline_formatting(text: &str) -> Vec<Line> {
    let mut lines = Vec::new();
    let chars: Vec<char> = text.chars().collect();
    let len = chars.len();
    let mut i = 0;
    let mut buf = String::new();
    let mut in_bold = false;
    let mut in_italic = false;

    while i < len {
        if i + 1 < len && chars[i] == '*' && chars[i+1] == '*' {
            // 遇到 **
            if !buf.is_empty() {
                lines.push(Line { text: buf.clone(), bold: in_bold, italic: in_italic });
                buf.clear();
            }
            in_bold = !in_bold;
            i += 2;
        } else if chars[i] == '*' && !in_bold {
            // 单个 *（且不在 bold 中才视为 italic）
            if !buf.is_empty() {
                lines.push(Line { text: buf.clone(), bold: in_bold, italic: in_italic });
                buf.clear();
            }
            in_italic = !in_italic;
            i += 1;
        } else {
            buf.push(chars[i]);
            i += 1;
        }
    }
    if !buf.is_empty() {
        lines.push(Line { text: buf, bold: in_bold, italic: in_italic });
    }
    lines
}

/// 构建 word/document.xml
fn build_document_xml(blocks: &[Block], title: Option<&str>) -> String {
    let mut xml = String::new();
    xml.push_str(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#);
    xml.push_str(r#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">"#);
    xml.push_str("<w:body>");

    // 可选标题
    if let Some(t) = title {
        xml.push_str(&run_paragraph(t, "Title", false, false));
    }

    for block in blocks {
        match block.style {
            BlockStyle::Empty => {
                xml.push_str("<w:p><w:pPr><w:spacing w:before=\"120\" w:after=\"120\"/></w:pPr><w:r><w:br/></w:r></w:p>");
            }
            BlockStyle::Normal => {
                if block.lines.is_empty() {
                    xml.push_str(&run_paragraph("", "Normal", false, false));
                } else {
                    xml.push_str(&build_paragraph(&block.lines, "Normal"));
                }
            }
            BlockStyle::Heading1 => {
                xml.push_str(&build_paragraph(&block.lines, "Heading1"));
            }
            BlockStyle::Heading2 => {
                xml.push_str(&build_paragraph(&block.lines, "Heading2"));
            }
            BlockStyle::Heading3 => {
                xml.push_str(&build_paragraph(&block.lines, "Heading3"));
            }
            BlockStyle::ListItem => {
                xml.push_str(&build_list_paragraph(&block.lines));
            }
        }
    }

    xml.push_str("</w:body></w:document>");
    xml
}

/// 构建普通标题/正文段落
fn build_paragraph(lines: &[Line], style: &str) -> String {
    let mut xml = String::new();
    let spacing = match style {
        "Heading1" => "w:before=\"240\" w:after=\"120\"",
        "Heading2" => "w:before=\"200\" w:after=\"100\"",
        "Heading3" => "w:before=\"160\" w:after=\"80\"",
        _ => "w:before=\"60\" w:after=\"60\" w:line=\"276\"",
    };
    xml.push_str(&format!("<w:p><w:pPr><w:pStyle w:val=\"{}\"/><w:spacing {}/></w:pPr>", style, spacing));
    for line in lines {
        xml.push_str("<w:r>");
        if line.bold {
            xml.push_str("<w:rPr><w:b/><w:rFonts w:eastAsia=\"SimSun\"/><w:sz w:val=\"21\"/><w:szCs w:val=\"21\"/></w:rPr>");
        } else if line.italic {
            xml.push_str("<w:rPr><w:i/><w:rFonts w:eastAsia=\"SimSun\"/><w:sz w:val=\"21\"/><w:szCs w:val=\"21\"/></w:rPr>");
        } else {
            xml.push_str("<w:rPr><w:rFonts w:eastAsia=\"SimSun\"/><w:sz w:val=\"21\"/><w:szCs w:val=\"21\"/></w:rPr>");
        }
        xml.push_str(&format!("<w:t xml:space=\"preserve\">{}</w:t>", escape_xml(&line.text)));
        xml.push_str("</w:r>");
    }
    xml.push_str("</w:p>");
    xml
}

/// 构建列表段落
fn build_list_paragraph(lines: &[Line]) -> String {
    let mut xml = String::new();
    xml.push_str("<w:p><w:pPr><w:pStyle w:val=\"ListParagraph\"/><w:numPr><w:ilvl w:val=\"0\"/><w:numId w:val=\"1\"/></w:numPr><w:spacing w:before=\"40\" w:after=\"40\" w:line=\"276\"/></w:pPr>");
    for line in lines {
        xml.push_str("<w:r><w:rPr><w:rFonts w:eastAsia=\"SimSun\"/><w:sz w:val=\"21\"/><w:szCs w:val=\"21\"/></w:rPr>");
        xml.push_str(&format!("<w:t xml:space=\"preserve\">{}</w:t>", escape_xml(&line.text)));
        xml.push_str("</w:r>");
    }
    xml.push_str("</w:p>");
    xml
}

/// 简单跑文段落
fn run_paragraph(text: &str, style: &str, bold: bool, italic: bool) -> String {
    let mut xml = String::new();
    xml.push_str(&format!("<w:p><w:pPr><w:pStyle w:val=\"{}\"/></w:pPr>", style));
    xml.push_str("<w:r><w:rPr>");
    if bold { xml.push_str("<w:b/>"); }
    if italic { xml.push_str("<w:i/>"); }
    xml.push_str("<w:rFonts w:eastAsia=\"SimSun\"/><w:sz w:val=\"21\"/><w:szCs w:val=\"21\"/></w:rPr>");
    xml.push_str(&format!("<w:t xml:space=\"preserve\">{}</w:t></w:r></w:p>", escape_xml(text)));
    xml
}

/// 构建 word/styles.xml
fn build_styles_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="SimSun" w:hAnsi="SimSun" w:eastAsia="SimSun" w:cs="SimSun"/>
        <w:sz w:val="21"/>
        <w:szCs w:val="21"/>
        <w:lang w:val="en-US" w:eastAsia="zh-CN"/>
      </w:rPr>
    </w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Normal" w:default="true">
    <w:name w:val="Normal"/>
    <w:pPr><w:spacing w:after="60" w:line="276"/></w:pPr>
    <w:rPr><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:pPr><w:spacing w:before="200" w:after="100"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:pPr><w:spacing w:before="160" w:after="80"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="ListParagraph">
    <w:name w:val="List Paragraph"/>
    <w:pPr><w:ind w:left="420"/></w:pPr>
  </w:style>
</w:styles>"#.to_string()
}

/// 简单 XML 转义
fn escape_xml(s: &str) -> String {
    s.replace('&', "&amp;")
     .replace('<', "&lt;")
     .replace('>', "&gt;")
     .replace('"', "&quot;")
     .replace('\'', "&apos;")
}
