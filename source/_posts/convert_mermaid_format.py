"""Bidirectional converter for Mermaid code blocks between Markdown and Hexo formats."""

import re
import sys
import argparse


def convert_to_hexo(content):
    """Convert Markdown mermaid blocks to Hexo format.
    
    Transforms: ```mermaid``` → {% mermaid %}
    """
    pattern = r"```mermaid\s*\n(.*?)\n```"
    
    def replace_block(match):
        code = match.group(1)
        return f"{{% mermaid %}}\n{code}\n{{% endmermaid %}}"
    
    return re.sub(pattern, replace_block, content, flags=re.DOTALL)


def convert_to_markdown(content):
    """Convert Hexo mermaid blocks to Markdown format.
    
    Transforms: {% mermaid %} → ```mermaid```
    """
    pattern = r"\{%\s*mermaid\s*%\}\s*\n(.*?)\n\{%\s*endmermaid\s*%\}"
    
    def replace_block(match):
        code = match.group(1)
        return f"```mermaid\n{code}\n```"
    
    return re.sub(pattern, replace_block, content, flags=re.DOTALL)


def detect_format(content):
    """Detect the current format of mermaid blocks.
    
    Returns:
        str: "markdown", "hexo", or None if no blocks found
    """
    markdown_count = len(re.findall(r"```mermaid", content))
    hexo_count = len(re.findall(r"\{%\s*mermaid\s*%\}", content))
    
    if markdown_count > hexo_count:
        return "markdown"
    elif hexo_count > markdown_count:
        return "hexo"
    return None


def main():
    """Main entry point for the converter."""
    parser = argparse.ArgumentParser(
        description="Bidirectional converter for Mermaid code blocks in Markdown files",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("input_file", help="Input Markdown file path")
    
    args = parser.parse_args()
    
    # Read input file
    try:
        with open(args.input_file, "r", encoding="utf-8") as f:
            content = f.read()
    except FileNotFoundError:
        print(f"Error: File '{args.input_file}' not found")
        sys.exit(1)
    
    # Detect current format
    current_format = detect_format(content)
    if current_format == "markdown":
        target_format = "hexo"
        print("Detected ```mermaid format, converting to {% mermaid %}")
    elif current_format == "hexo":
        target_format = "markdown"
        print("Detected {% mermaid %} format, converting to ```mermaid")
    else:
        print("Error: No valid mermaid code blocks detected")
        sys.exit(1)
    
    # Perform conversion
    if target_format == "hexo":
        converted_content = convert_to_hexo(content)
        format_name = "{% mermaid %}"
    else:
        converted_content = convert_to_markdown(content)
        format_name = "```mermaid"
    
    # Save result
    with open(args.input_file, "w", encoding="utf-8") as f:
        f.write(converted_content)
    
    print(f"Converted to {format_name} format")


if __name__ == "__main__":
    main()
