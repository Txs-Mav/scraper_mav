"""Tests unitaires pour html_cleanup.

Fixent le contrat critique : JSON-LD, JSON, microdata et og-meta DOIVENT
survivre au nettoyage, sinon Claude perd l'extraction prix sur la majorité
des sites e-commerce modernes.

Lancer : ``pytest scraper_ai/scraper_usine/test_html_cleanup.py -v``
"""
from __future__ import annotations

from scraper_ai.scraper_usine.html_cleanup import (
    clean_html_for_llm,
    estimate_token_savings,
)


def test_strips_inline_javascript():
    html = """<html><head><script>alert('xss')</script></head><body><h1>Hi</h1></body></html>"""
    out = clean_html_for_llm(html)
    assert "alert" not in out
    assert "Hi" in out


def test_strips_javascript_with_explicit_type():
    html = """<script type="text/javascript">var x = 1;</script><p>keep</p>"""
    out = clean_html_for_llm(html)
    assert "var x" not in out
    assert "keep" in out


def test_keeps_jsonld_script():
    """CRITIQUE : JSON-LD est la source du prix sur Shopify/eDealer/Magento."""
    html = """
    <html><head>
    <script type="application/ld+json">
    {"@type":"Product","name":"Honda CBR","offers":{"price":11999}}
    </script>
    </head><body><p>Body</p></body></html>
    """
    out = clean_html_for_llm(html)
    assert "application/ld+json" in out
    assert "Honda CBR" in out
    assert "11999" in out
    assert "@type" in out


def test_keeps_application_json():
    """Next.js __NEXT_DATA__ et payloads structurés similaires."""
    html = """
    <script id="__NEXT_DATA__" type="application/json">
    {"props":{"product":{"price":2499}}}
    </script>
    <p>visible</p>
    """
    out = clean_html_for_llm(html)
    assert "application/json" in out
    assert "2499" in out
    assert "visible" in out


def test_keeps_microdata_json():
    html = """<script type="application/microdata+json">{"name":"x"}</script>"""
    out = clean_html_for_llm(html)
    assert "application/microdata+json" in out


def test_strips_style_tags():
    html = """<html><head><style>body{color:red}</style></head><body>ok</body></html>"""
    out = clean_html_for_llm(html)
    assert "color:red" not in out
    assert "ok" in out


def test_strips_svg_and_iframe():
    html = """
    <body>
      <svg><circle cx="10"/></svg>
      <iframe src="x"></iframe>
      <p>kept</p>
    </body>
    """
    out = clean_html_for_llm(html)
    assert "<svg" not in out
    assert "<iframe" not in out
    assert "kept" in out


def test_strips_html_comments():
    html = """<body><!-- this is a comment --><p>visible</p></body>"""
    out = clean_html_for_llm(html)
    assert "this is a comment" not in out
    assert "visible" in out


def test_strips_inline_style_attribute():
    html = """<p style="color:red">hello</p>"""
    out = clean_html_for_llm(html)
    assert "color:red" not in out
    assert "hello" in out


def test_keeps_semantic_data_attrs():
    """data-price-amount, data-product-id etc. peuvent servir de sélecteur."""
    html = """
    <span data-price-amount="11999" data-product-id="42" data-toggle="modal">$120</span>
    """
    out = clean_html_for_llm(html)
    assert "data-price-amount" in out
    assert "data-product-id" in out
    # data-toggle est non sémantique pour le scraping → retiré
    assert "data-toggle" not in out


def test_keeps_microdata_attributes():
    html = """
    <div itemscope itemtype="https://schema.org/Product">
      <span itemprop="name">Honda</span>
      <meta itemprop="price" content="11999"/>
    </div>
    """
    out = clean_html_for_llm(html)
    assert "itemscope" in out
    assert "itemtype" in out
    assert "itemprop" in out
    assert "Honda" in out
    assert "11999" in out


def test_keeps_og_and_twitter_meta():
    html = """
    <head>
      <meta property="og:title" content="Honda CBR"/>
      <meta property="og:image" content="https://x/img.jpg"/>
      <meta name="twitter:card" content="summary"/>
    </head>
    """
    out = clean_html_for_llm(html)
    assert "og:title" in out
    assert "og:image" in out
    assert "twitter:card" in out


def test_aggressive_false_preserves_more():
    html = """
    <body>
      <svg><circle/></svg>
      <p style="color:red">hi</p>
      <!-- comment -->
    </body>
    """
    out = clean_html_for_llm(html, aggressive=False)
    # En mode non-agressif, SVG et commentaires restent
    assert "<svg" in out
    assert "comment" in out
    # Style attribute aussi
    assert "color:red" in out


def test_handles_empty_input():
    assert clean_html_for_llm("") == ""
    assert clean_html_for_llm(None) == ""


def test_estimate_savings_returns_dict():
    html = "<html><script>js stuff repeated " * 100 + "</script><p>tiny</p></html>"
    info = estimate_token_savings(html)
    assert "before_chars" in info
    assert "after_chars" in info
    assert "savings_pct" in info
    assert info["after_chars"] < info["before_chars"]
    assert info["savings_pct"] > 0


def test_real_world_shopify_like():
    """Cas réel : page produit Shopify-like avec JSON-LD + scripts analytics."""
    html = """
    <!DOCTYPE html>
    <html>
    <head>
      <title>Honda CBR 600</title>
      <meta property="og:title" content="Honda CBR 600"/>
      <script type="application/ld+json">
      {"@type":"Product","name":"Honda CBR 600","offers":{"@type":"Offer","price":"11999.00","priceCurrency":"CAD"}}
      </script>
      <script>window.dataLayer=[];gtag('config','GA-XXX');</script>
      <style>.hidden{display:none}</style>
    </head>
    <body>
      <h1 class="product__title">Honda CBR 600</h1>
      <span class="price" data-price-amount="11999">$11,999.00</span>
      <iframe src="https://tracker.com"></iframe>
    </body>
    </html>
    """
    out = clean_html_for_llm(html)
    # Tout ce qui sert au scraping prix doit être là
    assert "11999" in out  # JSON-LD price
    assert "data-price-amount" in out  # data-attr sémantique
    assert "og:title" in out  # fallback name
    assert "product__title" in out  # selector class
    # Tout le bruit doit être parti
    assert "dataLayer" not in out
    assert "gtag" not in out
    assert ".hidden" not in out
    assert "tracker.com" not in out
