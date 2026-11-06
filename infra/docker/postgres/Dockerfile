# PostgreSQL 17 + pgvector 0.8 + PostGIS 3, the server the migrations target
# (ADR-0003). For the dev stack and CI; production uses the managed or hosted
# server chosen in ser-p00-02.
#
# The pgvector image is the official postgres:17 image on Debian bookworm,
# whose apt.postgresql.org repository also ships PostGIS.
FROM pgvector/pgvector:0.8.1-pg17-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-17-postgis-3 \
  && rm -rf /var/lib/apt/lists/*
